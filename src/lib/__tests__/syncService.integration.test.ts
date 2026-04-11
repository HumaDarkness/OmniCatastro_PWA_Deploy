import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
    const mockListOfflineWrites = vi.fn();
    const mockCountOfflineWrites = vi.fn();
    const mockRemoveOfflineWrite = vi.fn();
    const mockMarkRetry = vi.fn();
    const mockMarkNeedsUserChoice = vi.fn();
    const mockMarkLocalWins = vi.fn();
    const mockGetOfflineWrite = vi.fn();
    const mockUpdateMeta = vi.fn();

    const mockUpsertExpedienteMvp = vi.fn();
    const mockGetExpedienteMvpByRc = vi.fn();
    const mockResolveConflictRpc = vi.fn();
    const mockGetSession = vi.fn();
    const mockMaybeSingle = vi.fn();

    const mockIsConflictV2Enabled = vi.fn();
    const mockTrackSyncEvent = vi.fn();

    const queryBuilder: {
        select: ReturnType<typeof vi.fn>;
        eq: ReturnType<typeof vi.fn>;
        order: ReturnType<typeof vi.fn>;
        limit: ReturnType<typeof vi.fn>;
        maybeSingle: ReturnType<typeof vi.fn>;
    } = {
        select: vi.fn(),
        eq: vi.fn(),
        order: vi.fn(),
        limit: vi.fn(),
        maybeSingle: mockMaybeSingle,
    };

    queryBuilder.select.mockReturnValue(queryBuilder);
    queryBuilder.eq.mockReturnValue(queryBuilder);
    queryBuilder.order.mockReturnValue(queryBuilder);
    queryBuilder.limit.mockReturnValue(queryBuilder);

    const mockFrom = vi.fn(() => queryBuilder);

    return {
        mockListOfflineWrites,
        mockCountOfflineWrites,
        mockRemoveOfflineWrite,
        mockMarkRetry,
        mockMarkNeedsUserChoice,
        mockMarkLocalWins,
        mockGetOfflineWrite,
        mockUpdateMeta,
        mockUpsertExpedienteMvp,
        mockGetExpedienteMvpByRc,
        mockResolveConflictRpc,
        mockGetSession,
        mockMaybeSingle,
        mockIsConflictV2Enabled,
        mockTrackSyncEvent,
        mockFrom,
    };
});

vi.mock("../offlineQueue", () => ({
    listOfflineExpedienteWrites: mocks.mockListOfflineWrites,
    countOfflineExpedienteWrites: mocks.mockCountOfflineWrites,
    removeOfflineExpedienteWrite: mocks.mockRemoveOfflineWrite,
    markOfflineExpedienteRetry: mocks.mockMarkRetry,
    markOfflineExpedienteNeedsUserChoice: mocks.mockMarkNeedsUserChoice,
    markOfflineExpedienteLocalWins: mocks.mockMarkLocalWins,
    getOfflineExpedienteWrite: mocks.mockGetOfflineWrite,
    updateOfflineExpedienteMeta: mocks.mockUpdateMeta,
}));

vi.mock("../supabase", () => ({
    upsertExpedienteMvp: mocks.mockUpsertExpedienteMvp,
    getExpedienteMvpByRc: mocks.mockGetExpedienteMvpByRc,
    resolveExpedienteMvpConflict: mocks.mockResolveConflictRpc,
    supabase: {
        auth: {
            getSession: mocks.mockGetSession,
        },
        from: mocks.mockFrom,
    },
}));

vi.mock("../featureFlags", () => ({
    isConflictV2Enabled: mocks.mockIsConflictV2Enabled,
}));

vi.mock("../syncTelemetry", () => ({
    trackSyncEvent: mocks.mockTrackSyncEvent,
}));

import {
    flushOfflineExpedienteQueueNow,
    resolveQueuedConflictWithLocalWins,
    resolveQueuedConflictWithRemoteWins,
    type ExpedienteNeedsResolutionDetail,
} from "../syncService";

function makeWrite(overrides: Record<string, unknown> = {}) {
    return {
        rc: "TEST-RC-001",
        datos: { descripcion: "local" },
        status: "en_progreso",
        queuedAt: "2026-04-10T11:59:00.000Z",
        localUpdatedAt: Date.now() - 10_000,
        retryCount: 0,
        conflictRetryCount: 0,
        lastError: null,
        expedienteId: "exp-1",
        versionToken: "v1",
        needsUserChoice: false,
        conflictContext: null,
        ...overrides,
    };
}

function makeDetail(): ExpedienteNeedsResolutionDetail {
    return {
        rc: "TEST-RC-001",
        write: makeWrite(),
        context: {
            localDatos: { descripcion: "local" },
            remoteDatos: { descripcion: "remote" },
            remoteVersion: "v-remote",
            localUpdatedAt: Date.now() - 30_000,
            remoteUpdatedAt: "2026-04-10T11:59:20.000Z",
            remoteExpedienteId: "exp-1",
            sameUser: false,
            recentCrossTabActivity: false,
            diffKeys: ["descripcion"],
        },
    };
}

describe("syncService integration", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv("VITE_EXPEDIENTES_RPC_ENABLED", "true");

        mocks.mockGetSession.mockResolvedValue({
            data: { session: { user: { id: "user-1" } } },
            error: null,
        });

        mocks.mockIsConflictV2Enabled.mockResolvedValue(true);
        mocks.mockCountOfflineWrites.mockResolvedValue(0);
        mocks.mockMaybeSingle.mockResolvedValue({ data: null, error: null });
        mocks.mockGetExpedienteMvpByRc.mockResolvedValue(null);
        mocks.mockGetOfflineWrite.mockResolvedValue(makeWrite());
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("returns zero report when canary flag is disabled", async () => {
        mocks.mockIsConflictV2Enabled.mockResolvedValue(false);

        const report = await flushOfflineExpedienteQueueNow("manual");

        expect(report).toEqual({ processed: 0, synced: 0, conflicts: 0, errors: 0, pending: 0 });
        expect(mocks.mockListOfflineWrites).not.toHaveBeenCalled();
    });

    it("flushes successful write and emits sync_success", async () => {
        mocks.mockListOfflineWrites.mockResolvedValue([makeWrite()]);
        mocks.mockUpsertExpedienteMvp.mockResolvedValue({
            ok: true,
            id: "exp-1",
            organizationId: "org-1",
            rc: "TEST-RC-001",
            status: "en_progreso",
            versionToken: "v2",
            updatedAt: "2026-04-10T12:00:00.000Z",
            lastSyncedAt: "2026-04-10T12:00:00.000Z",
        });

        const report = await flushOfflineExpedienteQueueNow("manual");

        expect(report.synced).toBe(1);
        expect(mocks.mockRemoveOfflineWrite).toHaveBeenCalledWith("TESTRC001");
        expect(mocks.mockTrackSyncEvent).toHaveBeenCalledWith(
            "sync_success",
            expect.objectContaining({ rc: "TESTRC001", reason: "manual" }),
        );
    });

    it("handles VERSION_CONFLICT with identical payload and emits write_discarded_identical", async () => {
        const write = makeWrite({
            datos: { descripcion: "same" },
            expedienteId: "exp-1",
            versionToken: "v1",
        });

        mocks.mockListOfflineWrites.mockResolvedValue([write]);
        mocks.mockUpsertExpedienteMvp.mockResolvedValue({ ok: false, error: "VERSION_CONFLICT" });
        mocks.mockMaybeSingle.mockResolvedValue({
            data: {
                id: "exp-1",
                datos: { descripcion: "same" },
                version_token: "v2",
                updated_at: "2026-04-10T12:00:00.000Z",
                updated_by: "user-2",
            },
            error: null,
        });

        const report = await flushOfflineExpedienteQueueNow("manual");

        expect(report.synced).toBe(0);
        expect(report.conflicts).toBe(0);
        expect(mocks.mockRemoveOfflineWrite).toHaveBeenCalledWith("TESTRC001");
        expect(mocks.mockTrackSyncEvent).toHaveBeenCalledWith(
            "write_discarded_identical",
            expect.objectContaining({ rc: "TESTRC001", reason: "identical_payload" }),
        );
    });

    it("emits conflict_user_local_wins and sync_success for manual local resolution", async () => {
        mocks.mockResolveConflictRpc.mockResolvedValue({
            ok: true,
            action: "local_wins",
            id: "exp-1",
            versionToken: "v3",
            updatedAt: "2026-04-10T12:01:00.000Z",
        });

        const report = await resolveQueuedConflictWithLocalWins(makeDetail());

        expect(report.synced).toBe(1);
        expect(mocks.mockRemoveOfflineWrite).toHaveBeenCalledWith("TEST-RC-001");
        expect(mocks.mockTrackSyncEvent).toHaveBeenCalledWith(
            "conflict_user_local_wins",
            expect.objectContaining({ rc: "TEST-RC-001", reason: "user_selected_local_wins" }),
        );
        expect(mocks.mockTrackSyncEvent).toHaveBeenCalledWith(
            "sync_success",
            expect.objectContaining({ rc: "TEST-RC-001", reason: "manual_local_wins" }),
        );
    });

    it("emits conflict_user_remote_wins for manual remote resolution", async () => {
        const report = await resolveQueuedConflictWithRemoteWins(makeDetail());

        expect(report.synced).toBe(0);
        expect(mocks.mockRemoveOfflineWrite).toHaveBeenCalledWith("TEST-RC-001");
        expect(mocks.mockTrackSyncEvent).toHaveBeenCalledWith(
            "conflict_user_remote_wins",
            expect.objectContaining({ rc: "TEST-RC-001", reason: "user_selected_remote_wins" }),
        );
    });
});
