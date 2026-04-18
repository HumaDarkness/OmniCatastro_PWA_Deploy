export type SyncEntityType = "cliente" | "ingeniero" | "asset";

export type SyncOperation = "upsert" | "delete" | "upload_blob" | "link_blob";

export type SyncJobStatus = "pending" | "processing" | "retry" | "done" | "failed" | "dead_letter";

export type SyncTrigger = "user_action" | "background" | "startup_recovery" | "manual_retry";

export interface SyncBlobRef {
  field: "dniBlobFront" | "dniBlobBack" | "firmaBlob" | "blob";
  mimeType: string;
  size: number;
  checksumSha256?: string;
  remotePath?: string;
}

export interface SyncJobPayloadBase {
  entityType: SyncEntityType;
  entityId: number;
  operation: SyncOperation;
  idempotencyKey: string;
  trigger: SyncTrigger;
}

export interface ClienteUpsertPayload extends SyncJobPayloadBase {
  entityType: "cliente";
  operation: "upsert";
  snapshot: {
    nif: string;
    nombre: string;
    apellidos: string;
    email?: string;
    telefono?: string;
    updatedAt: number;
  };
  blobs?: SyncBlobRef[];
}

export interface IngenieroUpsertPayload extends SyncJobPayloadBase {
  entityType: "ingeniero";
  operation: "upsert";
  snapshot: {
    nif: string;
    nombre: string;
    apellidos: string;
    colegiado?: string;
    email?: string;
    isActive: 0 | 1;
    updatedAt: number;
  };
  blobs?: SyncBlobRef[];
}

export interface DeletePayload extends SyncJobPayloadBase {
  operation: "delete";
  remoteId?: string;
}

export type SyncJobPayload = ClienteUpsertPayload | IngenieroUpsertPayload | DeletePayload;

export interface SyncJobRecord {
  id?: number;
  queue: "default" | "clientes" | "ingenieros";
  entityType: SyncEntityType;
  entityId: number;
  operation: SyncOperation;

  status: SyncJobStatus;
  priority: number; // 0 = máxima prioridad
  attemptCount: number;
  maxAttempts: number;

  runAfter: number; // backoff scheduling
  lockedAt?: number; // lease start
  lockToken?: string; // worker ownership
  leaseMs?: number; // evita doble ejecución

  idempotencyKey: string;
  dedupeKey: string; // entityType:entityId:operation
  trigger: SyncTrigger;

  payload: SyncJobPayload;
  errorCode?: string;
  errorMessage?: string;
  lastHttpStatus?: number;

  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
}

// ── Service Contract ────────────────────────────────────────────────────────

export interface EnqueueSyncJobInput {
  queue?: "default" | "clientes" | "ingenieros";
  entityType: SyncEntityType;
  entityId: number;
  operation: SyncOperation;
  priority?: number;
  trigger?: SyncTrigger;
  payload: SyncJobPayload;
}

export interface SyncBatchOptions {
  now?: number;
  limit?: number; // default 10
  lockToken: string; // crypto.randomUUID()
  leaseMs?: number; // default 30_000
}

export interface SyncExecutionContext {
  signal?: AbortSignal;
  networkTimeoutMs?: number;
}

export interface JobExecutionResult {
  ok: boolean;
  retryable: boolean;
  remoteId?: string;
  httpStatus?: number;
  errorCode?: string;
  errorMessage?: string;
  nextRunAfter?: number;
}

export interface PullSyncResult {
  updated: number;
  skipped: number;
  withImages: number;
  message?: string;
  listErrors?: string[];
}

export interface ClientSyncService {
  pullFromCloud(options?: {
    silent?: boolean;
    onProgress?: (msg: string) => void;
  }): Promise<PullSyncResult>;

  enqueue(input: EnqueueSyncJobInput): Promise<number>;
  enqueueClienteUpsert(clienteId: number, trigger?: SyncTrigger): Promise<number>;
  enqueueIngenieroUpsert(ingenieroId: number, trigger?: SyncTrigger): Promise<number>;
  enqueueUnsyncedClientes(limit?: number): Promise<number>;

  claimBatch(options: SyncBatchOptions): Promise<SyncJobRecord[]>;
  processBatch(
    options: SyncBatchOptions,
    ctx?: SyncExecutionContext
  ): Promise<{
    processed: number;
    succeeded: number;
    retried: number;
    failed: number;
  }>;

  executeJob(job: SyncJobRecord, ctx?: SyncExecutionContext): Promise<JobExecutionResult>;
  markDone(jobId: number, lockToken: string, meta?: Partial<SyncJobRecord>): Promise<void>;
  markRetry(jobId: number, lockToken: string, result: JobExecutionResult): Promise<void>;
  markFailed(jobId: number, lockToken: string, result: JobExecutionResult): Promise<void>;

  recoverStaleLocks(now?: number): Promise<number>;
  compactQueue(entityType: SyncEntityType, entityId: number): Promise<void>;
}
