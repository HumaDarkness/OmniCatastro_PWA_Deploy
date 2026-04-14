import Dexie from 'dexie';
import type { Table } from 'dexie';
import type { QuickFillClientDTO, AssetDTO } from '../../contracts/hoja-encargo';
import type { SyncJobRecord } from '../../lib/clientSyncService.types';

// ── Nuevas interfaces ────────────────────────────────────────────────────────

export interface ClienteLocal {
  id?: number;
  // Datos de identidad
  nombre: string;
  apellidos: string;
  nif: string;
  email?: string;
  telefono?: string;
  // Blobs nativos — NUNCA Object URL strings
  dniBlobFront?: Blob;
  dniBlobBack?: Blob;
  // Metadatos
  fuenteOrigen: 'calculadora' | 'crm' | 'hoja_encargo';
  syncedAt?: number;       // timestamp Unix, null = pendiente de sync
  createdAt: number;
  updatedAt: number;
}

export interface IngenieroLocal {
  id?: number;
  nombre: string;
  apellidos: string;
  nif: string;             // NIF/DNI del técnico
  colegiado?: string;      // Nº colegiado
  email?: string;
  firmaBlob?: Blob;        // PNG procesado por el Worker (fondo transparente)
  isActive: 0 | 1;        // IndexedDB no indexa boolean → 0/1
  createdAt: number;
  updatedAt: number;
}

// ── DB class ─────────────────────────────────────────────────────────────────

export class OmniCatastroDB extends Dexie {
  quickFillClients!: Table<QuickFillClientDTO, number>;
  assets!: Table<AssetDTO, number>;
  clientes!: Table<ClienteLocal, number>;
  ingenieros!: Table<IngenieroLocal, number>;
  sync_jobs!: Table<SyncJobRecord, number>;

  constructor() {
    super('OmniCatastroDB');

    // v1: esquema original — NO modificar, Dexie lo necesita para migraciones
    this.version(1).stores({
      quickFillClients: '++id, nif, lastUsedAt',
      assets: '++id, alias, type, createdAt',
    });

    // v2: nuevas tablas, sin upgrade() = migración no-destructiva automática
    this.version(2).stores({
      quickFillClients: '++id, nif, lastUsedAt',
      assets: '++id, alias, type, createdAt',
      clientes:   '++id, &nif, nombre, fuenteOrigen, syncedAt, createdAt',
      ingenieros: '++id, &nif, isActive, createdAt',
      // Nota: los campos Blob NO se indexan, solo se almacenan
    });

    // v3: Outbox queue genérica para sincronización en background
    this.version(3).stores({
      quickFillClients: '++id, nif, lastUsedAt',
      assets: '++id, alias, type, createdAt',
      clientes: '++id, &nif, nombre, fuenteOrigen, syncedAt, createdAt, updatedAt',
      ingenieros: '++id, &nif, isActive, createdAt, updatedAt',
      sync_jobs: [
        '++id',
        'queue',
        'status',
        'runAfter',
        'priority',
        'entityType',
        'entityId',
        'operation',
        '&dedupeKey',
        'idempotencyKey',
        '[status+runAfter]',
        '[status+priority]',
        '[entityType+entityId]',
        '[queue+status+runAfter]',
        'createdAt',
        'updatedAt'
      ].join(', ')
    });
  }

  // ── Helpers de clientes ───────────────────────────────────────────────────

  /** Upsert por NIF: crea si no existe, actualiza si ya existe */
  async upsertCliente(data: Omit<ClienteLocal, 'id' | 'createdAt' | 'updatedAt'>): Promise<number> {
    const existing = await this.clientes.where('nif').equals(data.nif).first();
    const now = Date.now();
    if (existing?.id) {
      await this.clientes.update(existing.id, { ...data, updatedAt: now });
      return existing.id;
    }
    return this.clientes.add({ ...data, createdAt: now, updatedAt: now });
  }

  // ── Helpers de ingenieros ─────────────────────────────────────────────────

  /** Activa un ingeniero de forma atómica: desactiva todos los demás */
  async setIngenieroActivo(id: number): Promise<void> {
    await this.transaction('rw', this.ingenieros, async () => {
      await this.ingenieros.where('isActive').equals(1).modify({ isActive: 0 });
      await this.ingenieros.update(id, { isActive: 1, updatedAt: Date.now() });
    });
  }

  async getIngenieroActivo(): Promise<IngenieroLocal | undefined> {
    return this.ingenieros.where('isActive').equals(1).first();
  }

  // ── Wipe total ────────────────────────────────────────────────────────────
  async wipeAllMachineState() {
    await Promise.all([
      this.quickFillClients.clear(),
      this.assets.clear(),
      this.clientes.clear(),
      this.ingenieros.clear(),
    ]);
  }
}

export const db = new OmniCatastroDB(); // Singleton — importar SIEMPRE este export
