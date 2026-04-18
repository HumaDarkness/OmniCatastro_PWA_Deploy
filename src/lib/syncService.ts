import {
  getExpedienteMvpByRc,
  resolveExpedienteMvpConflict,
  supabase,
  upsertExpedienteMvp,
} from "./supabase";
import { isConflictV2Enabled } from "./featureFlags";
import {
  countOfflineExpedienteWrites,
  getOfflineExpedienteWrite,
  listOfflineExpedienteWrites,
  markOfflineExpedienteLocalWins,
  markOfflineExpedienteNeedsUserChoice,
  markOfflineExpedienteRetry,
  removeOfflineExpedienteWrite,
  updateOfflineExpedienteMeta,
  type OfflineExpedienteWrite,
} from "./offlineQueue";
import { trackSyncEvent } from "./syncTelemetry";

export type SyncReason = "startup" | "interval" | "online" | "manual";

export interface ExpedienteSyncReport {
  processed: number;
  synced: number;
  conflicts: number;
  errors: number;
  pending: number;
}

export type ConflictResolution = "local_wins" | "remote_wins" | "user_choice";

export interface ConflictContext {
  localDatos: Record<string, unknown>;
  remoteDatos: Record<string, unknown>;
  remoteVersion: string;
  localUpdatedAt: number;
  remoteUpdatedAt: string;
  remoteExpedienteId: string;
  sameUser: boolean;
  recentCrossTabActivity: boolean;
  diffKeys: string[];
}

export interface ExpedienteNeedsResolutionDetail {
  rc: string;
  write: OfflineExpedienteWrite;
  context: ConflictContext;
}

export interface ExpedienteAlreadySyncedDetail {
  rc: string;
}

export const EXPEDIENTE_NEEDS_RESOLUTION_EVENT = "expediente:needs_resolution";
export const EXPEDIENTE_REMOTE_ACCEPTED_EVENT = "expediente:remote_accepted";
export const EXPEDIENTE_ALREADY_SYNCED_EVENT = "expediente:already_synced";

const SYNC_INTERVAL_MS = 30_000;
const RETRY_LOCAL_WINS_WINDOW_MS = 120_000;
const CROSS_TAB_ACTIVITY_WINDOW_MS = 30_000;
const CROSS_TAB_RETENTION_MS = 300_000;
const TAB_ID =
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const WRITE_CHANNEL_NAME = "omnicatastro.expediente_writes";

let writeChannel: BroadcastChannel | null = null;
const recentCrossTabWrites = new Map<string, number>();

interface BroadcastWriteMessage {
  type: "expediente_write";
  rc: string;
  ts: number;
  tabId: string;
}

interface RemoteExpedienteSnapshot {
  id: string;
  datos: Record<string, unknown>;
  versionToken: string;
  updatedAt: string;
  updatedBy: string | null;
}

function normalizeRc(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function buildErrorMessage(error: string, hint?: string): string {
  return hint ? `${error}: ${hint}` : error;
}

function isMvpRpcEnvEnabled(): boolean {
  return String(import.meta.env.VITE_EXPEDIENTES_RPC_ENABLED ?? "false").toLowerCase() === "true";
}

export function isExpedienteMvpSyncEnabled(): boolean {
  return isMvpRpcEnvEnabled();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringOrNull(value: unknown): string | null {
  const parsed = asString(value);
  return parsed ? parsed : null;
}

function pruneCrossTabWrites(now: number): void {
  for (const [rc, ts] of recentCrossTabWrites) {
    if (now - ts > CROSS_TAB_RETENTION_MS) {
      recentCrossTabWrites.delete(rc);
    }
  }
}

function ensureWriteChannel(): void {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined" || writeChannel) {
    return;
  }

  writeChannel = new BroadcastChannel(WRITE_CHANNEL_NAME);
  writeChannel.onmessage = (event: MessageEvent<BroadcastWriteMessage>) => {
    const payload = event.data;
    if (!payload || payload.type !== "expediente_write") return;
    if (payload.tabId === TAB_ID) return;

    const rc = normalizeRc(payload.rc);
    if (!rc) return;

    const now = Date.now();
    recentCrossTabWrites.set(rc, Number.isFinite(payload.ts) ? payload.ts : now);
    pruneCrossTabWrites(now);
  };
}

export function announceExpedienteTabWrite(rc: string): void {
  if (!isMvpRpcEnvEnabled() || typeof window === "undefined") return;

  const normalized = normalizeRc(rc);
  if (!normalized) return;

  ensureWriteChannel();
  if (!writeChannel) return;

  const message: BroadcastWriteMessage = {
    type: "expediente_write",
    rc: normalized,
    ts: Date.now(),
    tabId: TAB_ID,
  };

  writeChannel.postMessage(message);
}

function hasRecentCrossTabWrite(rc: string, windowMs: number): boolean {
  const normalized = normalizeRc(rc);
  if (!normalized) return false;

  const now = Date.now();
  pruneCrossTabWrites(now);
  const timestamp = recentCrossTabWrites.get(normalized);
  if (!timestamp) return false;

  return now - timestamp <= windowMs;
}

function diffKeys(
  localDatos: Record<string, unknown>,
  remoteDatos: Record<string, unknown>
): string[] {
  const keys = new Set<string>([...Object.keys(localDatos), ...Object.keys(remoteDatos)]);

  const changed: string[] = [];
  for (const key of keys) {
    const localValue = localDatos[key];
    const remoteValue = remoteDatos[key];
    if (JSON.stringify(localValue) !== JSON.stringify(remoteValue)) {
      changed.push(key);
    }
  }

  return changed;
}

function emitNeedsResolution(detail: ExpedienteNeedsResolutionDetail): void {
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent<ExpedienteNeedsResolutionDetail>(EXPEDIENTE_NEEDS_RESOLUTION_EVENT, {
      detail,
    })
  );
}

function emitRemoteAccepted(detail: ExpedienteNeedsResolutionDetail): void {
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent<ExpedienteNeedsResolutionDetail>(EXPEDIENTE_REMOTE_ACCEPTED_EVENT, {
      detail,
    })
  );
}

function emitAlreadySynced(detail: ExpedienteAlreadySyncedDetail): void {
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent<ExpedienteAlreadySyncedDetail>(EXPEDIENTE_ALREADY_SYNCED_EVENT, {
      detail,
    })
  );
}

function toStoredConflictContext(context: ConflictContext) {
  return {
    remoteDatos: context.remoteDatos,
    remoteVersion: context.remoteVersion,
    remoteUpdatedAt: context.remoteUpdatedAt,
    remoteExpedienteId: context.remoteExpedienteId,
    sameUser: context.sameUser,
    recentCrossTabActivity: context.recentCrossTabActivity,
    diffKeys: context.diffKeys,
  };
}

function contextFromStoredConflict(write: OfflineExpedienteWrite): ConflictContext | null {
  if (!write.conflictContext) return null;

  return {
    localDatos: write.datos,
    remoteDatos: write.conflictContext.remoteDatos,
    remoteVersion: write.conflictContext.remoteVersion,
    localUpdatedAt: write.localUpdatedAt,
    remoteUpdatedAt: write.conflictContext.remoteUpdatedAt,
    remoteExpedienteId: write.conflictContext.remoteExpedienteId,
    sameUser: write.conflictContext.sameUser,
    recentCrossTabActivity: write.conflictContext.recentCrossTabActivity,
    diffKeys: write.conflictContext.diffKeys,
  };
}

async function getCurrentUserId(): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) return null;
    return data.session?.user?.id ?? null;
  } catch {
    return null;
  }
}

async function isSyncEnabledForCurrentUser(): Promise<boolean> {
  if (!isMvpRpcEnvEnabled()) return false;

  const userId = await getCurrentUserId();
  if (!userId) {
    return isMvpRpcEnvEnabled();
  }

  return isConflictV2Enabled(userId);
}

async function fetchRemoteExpedienteSnapshot(
  write: OfflineExpedienteWrite
): Promise<RemoteExpedienteSnapshot | null> {
  const selection = "id, datos, version_token, updated_at, updated_by";
  const rc = normalizeRc(write.rc);
  if (!rc) return null;

  const queryById = async () =>
    supabase
      .from("expedientes")
      .select(selection)
      .eq("id", write.expedienteId)
      .limit(1)
      .maybeSingle();

  const queryByRc = async () =>
    supabase
      .from("expedientes")
      .select(selection)
      .eq("rc", rc)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

  const { data, error } = write.expedienteId ? await queryById() : await queryByRc();

  if (error || !data) {
    if (write.expedienteId) {
      const fallback = await queryByRc();
      if (fallback.error || !fallback.data) return null;
      const record = fallback.data as Record<string, unknown>;
      return {
        id: asString(record.id),
        datos: asRecord(record.datos),
        versionToken: asString(record.version_token),
        updatedAt: asString(record.updated_at),
        updatedBy: asStringOrNull(record.updated_by),
      };
    }
    return null;
  }

  const record = data as Record<string, unknown>;
  return {
    id: asString(record.id),
    datos: asRecord(record.datos),
    versionToken: asString(record.version_token),
    updatedAt: asString(record.updated_at),
    updatedBy: asStringOrNull(record.updated_by),
  };
}

export async function resolveConflict(
  write: OfflineExpedienteWrite,
  conflictContext: ConflictContext
): Promise<ConflictResolution> {
  const isSamePayload = conflictContext.diffKeys.length === 0;
  if (isSamePayload) {
    return "remote_wins";
  }

  if ((write.conflictRetryCount ?? 0) >= 1) {
    return "user_choice";
  }

  const deltaMs = Math.max(0, Date.now() - conflictContext.localUpdatedAt);
  const isNetworkRetryWindow =
    write.retryCount > 0 && write.retryCount <= 3 && deltaMs < RETRY_LOCAL_WINS_WINDOW_MS;

  if (isNetworkRetryWindow) {
    return "local_wins";
  }

  return "user_choice";
}

async function handleVersionConflict(write: OfflineExpedienteWrite): Promise<{
  ok: boolean;
  conflict: boolean;
  discardAsSynced?: boolean;
  requeued?: boolean;
  needsResolution?: boolean;
  errorMessage?: string;
}> {
  const remote = await fetchRemoteExpedienteSnapshot(write);
  if (!remote || !remote.id || !remote.versionToken) {
    return {
      ok: false,
      conflict: true,
      errorMessage: "VERSION_CONFLICT_CONTEXT_UNAVAILABLE",
    };
  }

  const currentUserId = await getCurrentUserId();
  const recentCrossTabActivity = hasRecentCrossTabWrite(write.rc, CROSS_TAB_ACTIVITY_WINDOW_MS);
  const localUpdatedAt = Number.isFinite(write.localUpdatedAt) ? write.localUpdatedAt : Date.now();

  const context: ConflictContext = {
    localDatos: write.datos,
    remoteDatos: remote.datos,
    remoteVersion: remote.versionToken,
    localUpdatedAt,
    remoteUpdatedAt: remote.updatedAt,
    remoteExpedienteId: remote.id,
    sameUser: Boolean(currentUserId && remote.updatedBy && currentUserId === remote.updatedBy),
    recentCrossTabActivity,
    diffKeys: diffKeys(write.datos, remote.datos),
  };

  trackSyncEvent("conflict_detected", {
    rc: write.rc,
    expedienteId: remote.id,
    diffKeys: context.diffKeys,
    sameUser: context.sameUser,
    recentCrossTabActivity: context.recentCrossTabActivity,
    conflictRetryCount: write.conflictRetryCount ?? 0,
    retryCount: write.retryCount,
  });

  const decision = await resolveConflict(write, context);

  if (decision === "remote_wins") {
    trackSyncEvent("write_discarded_identical", {
      rc: write.rc,
      expedienteId: remote.id,
      diffKeys: context.diffKeys,
      reason: "identical_payload",
    });

    return {
      ok: true,
      conflict: false,
      discardAsSynced: true,
    };
  }

  if (decision === "local_wins") {
    trackSyncEvent("conflict_user_local_wins", {
      rc: write.rc,
      expedienteId: remote.id,
      diffKeys: context.diffKeys,
      reason: "auto_retry_window",
      conflictRetryCount: write.conflictRetryCount ?? 0,
      retryCount: write.retryCount,
    });

    await markOfflineExpedienteLocalWins(write.rc, {
      expedienteId: remote.id,
      versionToken: remote.versionToken,
    });
    return {
      ok: false,
      conflict: true,
      requeued: true,
    };
  }

  trackSyncEvent("conflict_user_choice", {
    rc: write.rc,
    expedienteId: remote.id,
    diffKeys: context.diffKeys,
    reason: "manual_resolution_required",
    conflictRetryCount: write.conflictRetryCount ?? 0,
    retryCount: write.retryCount,
  });

  await markOfflineExpedienteNeedsUserChoice(write.rc, toStoredConflictContext(context), {
    expedienteId: remote.id,
    versionToken: remote.versionToken,
  });

  const queued = await getOfflineExpedienteWrite(write.rc);
  emitNeedsResolution({
    rc: write.rc,
    write: queued ?? write,
    context,
  });

  return {
    ok: false,
    conflict: true,
    needsResolution: true,
  };
}

async function pushOneWrite(write: OfflineExpedienteWrite): Promise<{
  ok: boolean;
  conflict?: boolean;
  discardAsSynced?: boolean;
  requeued?: boolean;
  needsResolution?: boolean;
  errorMessage?: string;
}> {
  let expedienteId = write.expedienteId;
  let versionToken = write.versionToken;

  if (!expedienteId || !versionToken) {
    const existing = await getExpedienteMvpByRc(write.rc);
    if (existing?.id && existing.versionToken) {
      expedienteId = existing.id;
      versionToken = existing.versionToken;
      await updateOfflineExpedienteMeta(write.rc, {
        expedienteId,
        versionToken,
      });
    }
  }

  const firstAttempt = await upsertExpedienteMvp({
    expedienteId,
    rc: write.rc,
    datos: write.datos,
    versionActual: versionToken,
    status: write.status,
    projectId: null,
  });

  if (firstAttempt.ok) {
    return { ok: true };
  }

  if (firstAttempt.error === "DUPLICATE_RC" && !expedienteId) {
    const existing = await getExpedienteMvpByRc(write.rc);
    if (existing?.id && existing.versionToken) {
      const retryAttempt = await upsertExpedienteMvp({
        expedienteId: existing.id,
        rc: write.rc,
        datos: write.datos,
        versionActual: existing.versionToken,
        status: write.status,
        projectId: null,
      });

      if (retryAttempt.ok) {
        return { ok: true };
      }

      if (retryAttempt.error === "VERSION_CONFLICT") {
        return handleVersionConflict({
          ...write,
          expedienteId: existing.id,
          versionToken: existing.versionToken,
        });
      }

      return {
        ok: false,
        conflict: retryAttempt.error === "VERSION_CONFLICT",
        errorMessage: buildErrorMessage(retryAttempt.error, retryAttempt.hint),
      };
    }
  }

  if (firstAttempt.error === "VERSION_CONFLICT") {
    return handleVersionConflict({
      ...write,
      expedienteId,
      versionToken,
    });
  }

  return {
    ok: false,
    conflict: false,
    errorMessage: buildErrorMessage(firstAttempt.error, firstAttempt.hint),
  };
}

export async function flushOfflineExpedienteQueueNow(
  reason: SyncReason = "manual"
): Promise<ExpedienteSyncReport> {
  if (!isMvpRpcEnvEnabled()) {
    return { processed: 0, synced: 0, conflicts: 0, errors: 0, pending: 0 };
  }

  const runtimeEnabled = await isSyncEnabledForCurrentUser();
  if (!runtimeEnabled) {
    return { processed: 0, synced: 0, conflicts: 0, errors: 0, pending: 0 };
  }

  ensureWriteChannel();

  const writes = await listOfflineExpedienteWrites();
  if (writes.length === 0) {
    return { processed: 0, synced: 0, conflicts: 0, errors: 0, pending: 0 };
  }

  let synced = 0;
  let conflicts = 0;
  let errors = 0;

  for (const write of writes) {
    const rc = normalizeRc(write.rc);
    if (!rc) {
      await removeOfflineExpedienteWrite(write.rc);
      continue;
    }

    if (write.needsUserChoice) {
      conflicts += 1;

      if (reason !== "interval") {
        const storedContext = contextFromStoredConflict(write);
        if (storedContext) {
          emitNeedsResolution({
            rc,
            write,
            context: storedContext,
          });
        }
      }

      continue;
    }

    const result = await pushOneWrite({
      ...write,
      rc,
    });

    if (result.ok) {
      if (result.discardAsSynced) {
        emitAlreadySynced({ rc });
      } else {
        synced += 1;
        trackSyncEvent("sync_success", {
          rc,
          reason,
        });
      }
      await removeOfflineExpedienteWrite(rc);
      continue;
    }

    if (result.needsResolution || result.requeued) {
      conflicts += 1;
      continue;
    }

    if (result.conflict) {
      conflicts += 1;
    } else {
      errors += 1;
    }

    trackSyncEvent("sync_error", {
      rc,
      reason,
      conflict: Boolean(result.conflict),
      errorMessage: result.errorMessage ?? "SYNC_FAILED",
    });

    await markOfflineExpedienteRetry(rc, result.errorMessage ?? "SYNC_FAILED", {
      expedienteId: write.expedienteId,
      versionToken: write.versionToken,
    });
  }

  const pending = await countOfflineExpedienteWrites();

  trackSyncEvent("sync_queue_flushed", {
    reason,
    processed: writes.length,
    synced,
    conflicts,
    errors,
    pending,
  });

  return {
    processed: writes.length,
    synced,
    conflicts,
    errors,
    pending,
  };
}

export function startExpedienteMvpSyncLoop(
  onReport?: (report: ExpedienteSyncReport, reason: SyncReason) => void
): () => void {
  if (!isMvpRpcEnvEnabled() || typeof window === "undefined") {
    return () => {
      // no-op
    };
  }

  ensureWriteChannel();

  let disposed = false;

  const run = async (reason: SyncReason) => {
    if (disposed) return;
    const report = await flushOfflineExpedienteQueueNow(reason);
    if (!disposed) onReport?.(report, reason);
  };

  const handleOnline = () => {
    void run("online");
  };

  void run("startup");
  window.addEventListener("online", handleOnline);
  const intervalId = window.setInterval(() => {
    void run("interval");
  }, SYNC_INTERVAL_MS);

  return () => {
    disposed = true;
    window.removeEventListener("online", handleOnline);
    window.clearInterval(intervalId);
  };
}

export async function resolveQueuedConflictWithLocalWins(
  detail: ExpedienteNeedsResolutionDetail
): Promise<ExpedienteSyncReport> {
  trackSyncEvent("conflict_user_local_wins", {
    rc: detail.rc,
    expedienteId: detail.context.remoteExpedienteId,
    diffKeys: detail.context.diffKeys,
    reason: "user_selected_local_wins",
  });

  const result = await resolveExpedienteMvpConflict({
    expedienteId: detail.context.remoteExpedienteId,
    localDatos: detail.write.datos,
    mode: "local_wins",
    expectedVersion: detail.context.remoteVersion,
  });

  if (result.ok) {
    await removeOfflineExpedienteWrite(detail.rc);
    const pending = await countOfflineExpedienteWrites();
    trackSyncEvent("sync_success", {
      rc: detail.rc,
      reason: "manual_local_wins",
    });
    return {
      processed: 1,
      synced: 1,
      conflicts: 0,
      errors: 0,
      pending,
    };
  }

  trackSyncEvent("sync_error", {
    rc: detail.rc,
    reason: "manual_local_wins",
    conflict: true,
    errorMessage: result.error,
  });

  await markOfflineExpedienteLocalWins(detail.rc, {
    expedienteId: detail.context.remoteExpedienteId,
    versionToken: detail.context.remoteVersion,
  });
  return flushOfflineExpedienteQueueNow("manual");
}

export async function resolveQueuedConflictWithRemoteWins(
  detail: ExpedienteNeedsResolutionDetail
): Promise<ExpedienteSyncReport> {
  trackSyncEvent("conflict_user_remote_wins", {
    rc: detail.rc,
    expedienteId: detail.context.remoteExpedienteId,
    diffKeys: detail.context.diffKeys,
    reason: "user_selected_remote_wins",
  });

  await removeOfflineExpedienteWrite(detail.rc);
  emitRemoteAccepted(detail);

  const pending = await countOfflineExpedienteWrites();
  return {
    processed: 1,
    synced: 0,
    conflicts: 0,
    errors: 0,
    pending,
  };
}
