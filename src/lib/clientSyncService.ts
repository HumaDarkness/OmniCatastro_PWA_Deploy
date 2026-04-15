import { db, type OmniCatastroDB } from '../infra/db/OmniCatastroDB';
import { supabase } from './supabase';
import { getCurrentOrganizationId } from './supabase';
import type { 
  ClientSyncService, 
  EnqueueSyncJobInput, 
  SyncBatchOptions, 
  SyncExecutionContext, 
  JobExecutionResult, 
  SyncJobRecord, 
  SyncEntityType, 
  SyncOperation 
} from './clientSyncService.types';

// ── UTILITIES ───────────────────────────────────────────────────────────────

export function buildDedupeKey(
  entityType: SyncEntityType,
  entityId: number,
  operation: SyncOperation
): string {
  return `${entityType}:${entityId}:${operation}`;
}

export function computeNextRunAfter(attemptCount: number, now = Date.now()): number {
  const base = 5_000;
  const cap = 15 * 60_000; // max 15 minutes logic
  const exp = Math.min(base * 2 ** attemptCount, cap);
  const jitter = Math.floor(Math.random() * 0.2 * exp);
  return now + exp + jitter;
}

// ── CLASS DEV IMPLEMENTATION ────────────────────────────────────────────────

class OmniClientSyncService implements ClientSyncService {
  private db: OmniCatastroDB;

  constructor(database: OmniCatastroDB) {
    this.db = database;
  }

  async enqueue(input: EnqueueSyncJobInput): Promise<number> {
    const now = Date.now();
    const dedupeKey = buildDedupeKey(input.entityType, input.entityId, input.operation);

    const existing = await this.db.sync_jobs.where('dedupeKey').equals(dedupeKey).first();

    if (existing && (existing.status === 'pending' || existing.status === 'retry')) {
      await this.db.sync_jobs.update(existing.id!, {
        payload: input.payload,
        priority: Math.min(existing.priority, input.priority ?? 50),
        updatedAt: now,
        runAfter: now
      });
      return existing.id!;
    }

    return this.db.sync_jobs.add({
      queue: input.queue ?? 'default',
      entityType: input.entityType,
      entityId: input.entityId,
      operation: input.operation,
      status: 'pending',
      priority: input.priority ?? 50,
      attemptCount: 0,
      maxAttempts: 8,
      runAfter: now,
      idempotencyKey: input.payload.idempotencyKey,
      dedupeKey,
      trigger: input.trigger ?? 'user_action',
      payload: input.payload,
      createdAt: now,
      updatedAt: now,
    });
  }

  async enqueueClienteUpsert(clienteId: number, trigger: 'user_action' | 'background' | 'startup_recovery' | 'manual_retry' = 'user_action'): Promise<number> {
    const clientLocal = await this.db.clientes.get(clienteId);
    if (!clientLocal) throw new Error("ClienteLocal no encontrado en IndexedDB.");

    return this.enqueue({
      queue: 'clientes',
      entityType: 'cliente',
      entityId: clienteId,
      operation: 'upsert',
      trigger,
      payload: {
        entityType: 'cliente',
        operation: 'upsert',
        entityId: clienteId,
        idempotencyKey: `${clienteId}_${clientLocal.updatedAt}`,
        trigger: trigger,
        snapshot: {
          nif: clientLocal.nif,
          nombre: clientLocal.nombre,
          apellidos: clientLocal.apellidos,
          email: clientLocal.email,
          telefono: clientLocal.telefono,
          updatedAt: clientLocal.updatedAt
        },
        blobs: [
          ...(clientLocal.dniBlobFront ? [{ field: 'dniBlobFront' as const, mimeType: clientLocal.dniBlobFront.type, size: clientLocal.dniBlobFront.size }] : []),
          ...(clientLocal.dniBlobBack ? [{ field: 'dniBlobBack' as const, mimeType: clientLocal.dniBlobBack.type, size: clientLocal.dniBlobBack.size }] : [])
        ]
      }
    });
  }

  async enqueueIngenieroUpsert(ingenieroId: number, trigger: 'user_action' | 'background' | 'startup_recovery' | 'manual_retry' = 'user_action'): Promise<number> {
    const ingenieroLocal = await this.db.ingenieros.get(ingenieroId);
    if (!ingenieroLocal) throw new Error("IngenieroLocal no encontrado.");

    return this.enqueue({
      queue: 'ingenieros',
      entityType: 'ingeniero',
      entityId: ingenieroId,
      operation: 'upsert',
      trigger,
      payload: {
        entityType: 'ingeniero',
        operation: 'upsert',
        entityId: ingenieroId,
        idempotencyKey: `${ingenieroId}_${ingenieroLocal.updatedAt}`,
        trigger: trigger,
        snapshot: {
          nif: ingenieroLocal.nif,
          nombre: ingenieroLocal.nombre,
          apellidos: ingenieroLocal.apellidos,
          colegiado: ingenieroLocal.colegiado,
          email: ingenieroLocal.email,
          isActive: ingenieroLocal.isActive,
          updatedAt: ingenieroLocal.updatedAt
        },
        blobs: [
          ...(ingenieroLocal.firmaBlob ? [{ field: 'firmaBlob' as const, mimeType: ingenieroLocal.firmaBlob.type, size: ingenieroLocal.firmaBlob.size }] : [])
        ]
      }
    });
  }

  async claimBatch({ now = Date.now(), limit = 10, lockToken, leaseMs = 30_000 }: SyncBatchOptions): Promise<SyncJobRecord[]> {
    return this.db.transaction('rw', this.db.sync_jobs, async () => {
      const jobsPending = await this.db.sync_jobs
        .where('[status+runAfter]')
        .between(['pending', 0], ['pending', now])
        .toArray();

      const jobsRetry = await this.db.sync_jobs
        .where('[status+runAfter]')
        .between(['retry', 0], ['retry', now])
        .toArray();

      const allReady = [...jobsPending, ...jobsRetry].sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
      const picked = allReady.slice(0, limit);

      await Promise.all(
        picked.map(job =>
          this.db.sync_jobs.update(job.id!, {
            status: 'processing',
            lockedAt: now,
            lockToken,
            leaseMs,
            updatedAt: now
          })
        )
      );

      return picked.map(job => ({
        ...job,
        status: 'processing' as const,
        lockedAt: now,
        lockToken,
        leaseMs
      }));
    });
  }

  async executeJob(job: SyncJobRecord): Promise<JobExecutionResult> {
    const orgId = getCurrentOrganizationId();
    if (!orgId) {
      return { ok: false, retryable: true, errorCode: 'NO_ORG_ID', errorMessage: 'Organización no disponible' };
    }

    try {
      if (job.entityType === 'cliente' && job.operation === 'upsert') {
        const liveClient = await this.db.clientes.get(job.entityId);
        if (!liveClient) {
          return { ok: false, retryable: false, errorCode: 'DELETED_LOCALLY', errorMessage: 'Cliente inexistente al sincronizar' };
        }

        // Subida de Blobs del cliente a Storage
        let updatedDniFrontPath: string | undefined = undefined;
        let updatedDniBackPath: string | undefined = undefined;

        if (liveClient.dniBlobFront) {
          const path = `${orgId}/clients/${liveClient.nif}_front.jpg`;
          const { error } = await supabase.storage.from('documents').upload(path, liveClient.dniBlobFront, {
            upsert: true,
            contentType: liveClient.dniBlobFront.type
          });
          if (error) throw new Error(`DNI Front upload failed: ${error.message}`);
          updatedDniFrontPath = path;
        }

        if (liveClient.dniBlobBack) {
          const path = `${orgId}/clients/${liveClient.nif}_back.jpg`;
          const { error } = await supabase.storage.from('documents').upload(path, liveClient.dniBlobBack, {
            upsert: true,
            contentType: liveClient.dniBlobBack.type
          });
          if (error) throw new Error(`DNI Back upload failed: ${error.message}`);
          updatedDniBackPath = path;
        }

        // Upsert de Metadato Cliente (compatibilidad con esquemas que no incluyen email/phone)
        const basePayload = {
          organization_id: orgId,
          dni: liveClient.nif,
          first_name: liveClient.nombre,
          last_name_1: liveClient.apellidos,
          dni_front_path: updatedDniFrontPath,
          dni_back_path: updatedDniBackPath,
          updated_at: new Date(liveClient.updatedAt).toISOString()
        };

        let { error: dbError } = await supabase.from('clients').upsert({
          ...basePayload,
          email: liveClient.email || null,
          phone: liveClient.telefono || null,
        }, { onConflict: 'organization_id, dni' });

        if (dbError && /column\s+clients\.(email|phone)\s+does not exist/i.test(dbError.message || '')) {
          const retry = await supabase.from('clients').upsert(basePayload, { onConflict: 'organization_id, dni' });
          dbError = retry.error;
        }

        if (dbError) {
          throw new Error(`Database upsert failed: ${dbError.message}`);
        }

        // Actualizamos que ya fue sincronizado para el local
        await this.db.clientes.update(liveClient.id!, { syncedAt: Date.now() });

        return { ok: true, retryable: false };

      } else {
        // Fallback genérico a otros procesos pendientes de desarrollo (ingenieros, deletes...)
        return { ok: false, retryable: false, errorCode: 'NOT_IMPLEMENTED', errorMessage: `Operación no procesador para ` };
      }

    } catch (e: any) {
      console.warn(`SyncJob ${job.id} falló:`, e.message);
      // Evaluamos si el error es de Red (retryable) o es Hard Fail. (La mayoría del tiempo la subida a DB en fallback network timeout es retryable)
      return { ok: false, retryable: true, errorMessage: e.message, errorCode: 'NETWORK_OR_API_ERROR' };
    }
  }

  async markDone(jobId: number, lockToken: string, meta?: Partial<SyncJobRecord>): Promise<void> {
    await this.db.sync_jobs.where({ id: jobId, lockToken }).modify({
      status: 'done',
      finishedAt: Date.now(),
      updatedAt: Date.now(),
      ...meta
    });
  }

  async markRetry(jobId: number, lockToken: string, result: JobExecutionResult): Promise<void> {
    const job = await this.db.sync_jobs.get(jobId);
    if (!job || job.lockToken !== lockToken) return;

    const newAttempts = job.attemptCount + 1;
    if (newAttempts >= job.maxAttempts) {
      await this.markFailed(jobId, lockToken, result);
      return;
    }

    const nextRun = result.nextRunAfter ?? computeNextRunAfter(newAttempts);

    await this.db.sync_jobs.update(jobId, {
      status: 'retry',
      attemptCount: newAttempts,
      runAfter: nextRun,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      lastHttpStatus: result.httpStatus,
      updatedAt: Date.now(),
      lockedAt: undefined,
      lockToken: undefined
    });
  }

  async markFailed(jobId: number, lockToken: string, result: JobExecutionResult): Promise<void> {
    await this.db.sync_jobs.where({ id: jobId, lockToken }).modify({
      status: 'dead_letter',
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      lastHttpStatus: result.httpStatus,
      finishedAt: Date.now(),
      updatedAt: Date.now(),
      lockedAt: undefined,
      lockToken: undefined
    });
  }

  async processBatch(options: SyncBatchOptions, ctx?: SyncExecutionContext): Promise<{ processed: number; succeeded: number; retried: number; failed: number; }> {
    const jobs = await this.claimBatch(options);
    let succeeded = 0;
    let retried = 0;
    let failed = 0;

    for (const job of jobs) {
      if (ctx?.signal?.aborted) break;

      const result = await this.executeJob(job);

      if (result.ok) {
        await this.markDone(job.id!, options.lockToken);
        succeeded++;
      } else if (result.retryable) {
        await this.markRetry(job.id!, options.lockToken, result);
        retried++;
      } else {
        await this.markFailed(job.id!, options.lockToken, result);
        failed++;
      }
    }

    return { processed: jobs.length, succeeded, retried, failed };
  }

  async recoverStaleLocks(now = Date.now()): Promise<number> {
    const staleLimit = now - 60_000; // 1 min lock tolerance
    const stalledJobs = await this.db.sync_jobs
      .where('status').equals('processing')
      .filter(j => !!j.lockedAt && j.lockedAt <= staleLimit)
      .toArray();

    if (stalledJobs.length === 0) return 0;

    await Promise.all(stalledJobs.map(job => 
      this.db.sync_jobs.update(job.id!, {
        status: 'retry', // return to retry
        lockedAt: undefined,
        lockToken: undefined,
        updatedAt: now
      })
    ));

    return stalledJobs.length;
  }

  async compactQueue(entityType: SyncEntityType, entityId: number): Promise<void> {
    // Purges old 'done'/'dead_letter' items
    await this.db.sync_jobs
      .where('[entityType+entityId]').equals([entityType, entityId])
      .filter(j => ['done', 'dead_letter'].includes(j.status))
      .delete();
  }
}

export const clientSyncService = new OmniClientSyncService(db);
