import { openDB, type DBSchema } from "idb";
import type { ExpedienteStatus } from "./supabase";

const DB_NAME = "omnicatastro_offline_queue";
const DB_VERSION = 1;
const STORE_NAME = "expediente_writes";

export interface OfflineExpedienteWrite {
  rc: string;
  datos: Record<string, unknown>;
  status: ExpedienteStatus;
  queuedAt: string;
  localUpdatedAt: number;
  retryCount: number;
  conflictRetryCount: number;
  lastError: string | null;
  expedienteId: string | null;
  versionToken: string | null;
  needsUserChoice: boolean;
  conflictContext: OfflineConflictContext | null;
}

export interface OfflineConflictContext {
  remoteDatos: Record<string, unknown>;
  remoteVersion: string;
  remoteUpdatedAt: string;
  remoteExpedienteId: string;
  sameUser: boolean;
  recentCrossTabActivity: boolean;
  diffKeys: string[];
}

export interface QueueExpedienteWriteInput {
  rc: string;
  datos: Record<string, unknown>;
  status: ExpedienteStatus;
  expedienteId?: string | null;
  versionToken?: string | null;
  lastError?: string | null;
  localUpdatedAt?: number;
  conflictRetryCount?: number;
  needsUserChoice?: boolean;
  conflictContext?: OfflineConflictContext | null;
}

interface OfflineQueueDb extends DBSchema {
  [STORE_NAME]: {
    key: string;
    value: OfflineExpedienteWrite;
    indexes: {
      queuedAt: string;
      retryCount: number;
    };
  };
}

const dbPromise = openDB<OfflineQueueDb>(DB_NAME, DB_VERSION, {
  upgrade(db) {
    if (db.objectStoreNames.contains(STORE_NAME)) return;

    const store = db.createObjectStore(STORE_NAME, { keyPath: "rc" });
    store.createIndex("queuedAt", "queuedAt");
    store.createIndex("retryCount", "retryCount");
  },
});

function normalizeRc(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function toNullable(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeEpoch(value: number | undefined): number {
  return Number.isFinite(value) ? Number(value) : Date.now();
}

function normalizeCounter(value: number | undefined, fallback = 0): number {
  if (!Number.isFinite(value)) return Math.max(0, fallback);
  return Math.max(0, Math.floor(Number(value)));
}

function withDefaults(record: OfflineExpedienteWrite): OfflineExpedienteWrite {
  return {
    ...record,
    localUpdatedAt: normalizeEpoch(record.localUpdatedAt),
    retryCount: normalizeCounter(record.retryCount),
    conflictRetryCount: normalizeCounter(record.conflictRetryCount),
    needsUserChoice: Boolean(record.needsUserChoice),
    conflictContext: record.conflictContext ?? null,
  };
}

export async function upsertOfflineExpedienteWrite(
  input: QueueExpedienteWriteInput
): Promise<OfflineExpedienteWrite | null> {
  const rc = normalizeRc(input.rc);
  if (!rc) return null;

  const db = await dbPromise;
  const existing = await db.get(STORE_NAME, rc);

  const defaultConflictRetries = input.needsUserChoice
    ? normalizeCounter(existing?.conflictRetryCount)
    : 0;

  const record: OfflineExpedienteWrite = {
    rc,
    datos: input.datos,
    status: input.status,
    queuedAt: new Date().toISOString(),
    localUpdatedAt: normalizeEpoch(input.localUpdatedAt),
    retryCount: normalizeCounter(existing?.retryCount),
    conflictRetryCount: normalizeCounter(input.conflictRetryCount, defaultConflictRetries),
    lastError: toNullable(input.lastError) ?? existing?.lastError ?? null,
    expedienteId: toNullable(input.expedienteId) ?? existing?.expedienteId ?? null,
    versionToken: toNullable(input.versionToken) ?? existing?.versionToken ?? null,
    needsUserChoice: Boolean(input.needsUserChoice),
    conflictContext: input.conflictContext ?? null,
  };

  await db.put(STORE_NAME, record);
  return record;
}

export async function listOfflineExpedienteWrites(): Promise<OfflineExpedienteWrite[]> {
  const db = await dbPromise;
  const records = await db.getAll(STORE_NAME);
  return [...records].map(withDefaults).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

export async function removeOfflineExpedienteWrite(rc: string): Promise<void> {
  const normalized = normalizeRc(rc);
  if (!normalized) return;

  const db = await dbPromise;
  await db.delete(STORE_NAME, normalized);
}

export async function markOfflineExpedienteRetry(
  rc: string,
  errorMessage: string,
  meta?: { expedienteId?: string | null; versionToken?: string | null }
): Promise<void> {
  const normalized = normalizeRc(rc);
  if (!normalized) return;

  const db = await dbPromise;
  const existing = await db.get(STORE_NAME, normalized);
  if (!existing) return;

  const next: OfflineExpedienteWrite = {
    ...existing,
    retryCount: normalizeCounter(existing.retryCount) + 1,
    conflictRetryCount: normalizeCounter(existing.conflictRetryCount),
    lastError: errorMessage,
    queuedAt: new Date().toISOString(),
    expedienteId: toNullable(meta?.expedienteId) ?? existing.expedienteId,
    versionToken: toNullable(meta?.versionToken) ?? existing.versionToken,
    needsUserChoice: false,
    conflictContext: null,
  };

  await db.put(STORE_NAME, next);
}

export async function updateOfflineExpedienteMeta(
  rc: string,
  meta: { expedienteId?: string | null; versionToken?: string | null }
): Promise<void> {
  const normalized = normalizeRc(rc);
  if (!normalized) return;

  const db = await dbPromise;
  const existing = await db.get(STORE_NAME, normalized);
  if (!existing) return;

  const next: OfflineExpedienteWrite = {
    ...existing,
    expedienteId: toNullable(meta.expedienteId) ?? existing.expedienteId,
    versionToken: toNullable(meta.versionToken) ?? existing.versionToken,
  };

  await db.put(STORE_NAME, next);
}

export async function getOfflineExpedienteWrite(
  rc: string
): Promise<OfflineExpedienteWrite | null> {
  const normalized = normalizeRc(rc);
  if (!normalized) return null;

  const db = await dbPromise;
  const record = await db.get(STORE_NAME, normalized);
  return record ? withDefaults(record) : null;
}

export async function markOfflineExpedienteNeedsUserChoice(
  rc: string,
  context: OfflineConflictContext,
  meta?: { expedienteId?: string | null; versionToken?: string | null }
): Promise<void> {
  const normalized = normalizeRc(rc);
  if (!normalized) return;

  const db = await dbPromise;
  const existing = await db.get(STORE_NAME, normalized);
  if (!existing) return;

  const next: OfflineExpedienteWrite = {
    ...existing,
    queuedAt: new Date().toISOString(),
    retryCount: normalizeCounter(existing.retryCount) + 1,
    conflictRetryCount: normalizeCounter(existing.conflictRetryCount) + 1,
    lastError: "VERSION_CONFLICT",
    expedienteId: toNullable(meta?.expedienteId) ?? existing.expedienteId,
    versionToken: toNullable(meta?.versionToken) ?? existing.versionToken,
    needsUserChoice: true,
    conflictContext: context,
  };

  await db.put(STORE_NAME, next);
}

export async function markOfflineExpedienteLocalWins(
  rc: string,
  meta: { expedienteId?: string | null; versionToken?: string | null }
): Promise<void> {
  const normalized = normalizeRc(rc);
  if (!normalized) return;

  const db = await dbPromise;
  const existing = await db.get(STORE_NAME, normalized);
  if (!existing) return;

  const next: OfflineExpedienteWrite = {
    ...existing,
    queuedAt: new Date().toISOString(),
    retryCount: normalizeCounter(existing.retryCount) + 1,
    conflictRetryCount: normalizeCounter(existing.conflictRetryCount) + 1,
    lastError: null,
    expedienteId: toNullable(meta.expedienteId) ?? existing.expedienteId,
    versionToken: toNullable(meta.versionToken) ?? existing.versionToken,
    needsUserChoice: false,
    conflictContext: null,
    // preserve original local intent timestamp to keep conflict heuristics coherent.
    localUpdatedAt: existing.localUpdatedAt,
  };

  await db.put(STORE_NAME, next);
}

export async function countOfflineExpedienteWrites(): Promise<number> {
  const db = await dbPromise;
  return db.count(STORE_NAME);
}

export async function clearOfflineExpedienteWrites(): Promise<void> {
  const db = await dbPromise;
  await db.clear(STORE_NAME);
}
