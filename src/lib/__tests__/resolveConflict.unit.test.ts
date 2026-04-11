import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../offlineQueue", () => ({
    countOfflineExpedienteWrites: vi.fn(),
    getOfflineExpedienteWrite: vi.fn(),
    listOfflineExpedienteWrites: vi.fn(),
    markOfflineExpedienteLocalWins: vi.fn(),
    markOfflineExpedienteNeedsUserChoice: vi.fn(),
    markOfflineExpedienteRetry: vi.fn(),
    removeOfflineExpedienteWrite: vi.fn(),
    updateOfflineExpedienteMeta: vi.fn(),
}));

vi.mock("../supabase", () => ({
    getExpedienteMvpByRc: vi.fn(),
    resolveExpedienteMvpConflict: vi.fn(),
    upsertExpedienteMvp: vi.fn(),
    supabase: {
        auth: {
            getSession: vi.fn(),
        },
        from: vi.fn(),
    },
}));

vi.mock("../featureFlags", () => ({
    isConflictV2Enabled: vi.fn().mockResolvedValue(true),
}));

vi.mock("../syncTelemetry", () => ({
    trackSyncEvent: vi.fn(),
}));

import { resolveConflict, type ConflictContext } from "../syncService";
import type { OfflineExpedienteWrite } from "../offlineQueue";

const NOW = new Date("2026-04-10T12:00:00.000Z").getTime();

function makeWrite(overrides: Partial<OfflineExpedienteWrite> = {}): OfflineExpedienteWrite {
    return {
        rc: "TEST-RC-001",
        datos: { descripcion: "local" },
        status: "en_progreso",
        queuedAt: "2026-04-10T11:59:00.000Z",
        localUpdatedAt: NOW - 60_000,
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

function makeContext(overrides: Partial<ConflictContext> = {}): ConflictContext {
    return {
        localDatos: { descripcion: "local" },
        remoteDatos: { descripcion: "remote" },
        remoteVersion: "v-remote",
        localUpdatedAt: NOW - 60_000,
        remoteUpdatedAt: "2026-04-10T11:59:30.000Z",
        remoteExpedienteId: "exp-1",
        sameUser: false,
        recentCrossTabActivity: false,
        diffKeys: ["descripcion"],
        ...overrides,
    };
}

describe("resolveConflict", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("returns remote_wins for identical payload", async () => {
        const decision = await resolveConflict(
            makeWrite(),
            makeContext({ diffKeys: [], localDatos: { x: 1 }, remoteDatos: { x: 1 } }),
        );

        expect(decision).toBe("remote_wins");
    });

    it("returns user_choice when conflict was already retried", async () => {
        const decision = await resolveConflict(
            makeWrite({ conflictRetryCount: 1, retryCount: 1 }),
            makeContext(),
        );

        expect(decision).toBe("user_choice");
    });

    it("returns local_wins in retry window for transient network conflicts", async () => {
        const decision = await resolveConflict(
            makeWrite({ retryCount: 1, localUpdatedAt: NOW - 45_000 }),
            makeContext({ localUpdatedAt: NOW - 45_000 }),
        );

        expect(decision).toBe("local_wins");
    });

    it("returns user_choice when retry window expired", async () => {
        const decision = await resolveConflict(
            makeWrite({ retryCount: 1, localUpdatedAt: NOW - 180_000 }),
            makeContext({ localUpdatedAt: NOW - 180_000 }),
        );

        expect(decision).toBe("user_choice");
    });
});
