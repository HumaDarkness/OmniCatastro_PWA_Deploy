import { supabase } from "../../lib/supabase";
import type {
  ClientAggregateV1,
  ClientAggregateV1Repository,
  ClientChangeEventV1,
  ClientDocumentKindV1,
  ClientSearchItemV1,
  CommitDocumentUploadV1Result,
  PrepareDocumentUploadV1Result,
  UpsertClientV1Result,
} from "../../domain/clients";

const DEFAULT_DEVICE_ID = "web-pwa";

function ensureSupabaseConfigured(): void {
  if (!supabase) {
    throw new Error("Supabase no configurado.");
  }
}

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Respuesta RPC inválida: se esperaba un objeto.");
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Respuesta RPC inválida: ${label} no es string.`);
  }
  return value;
}

function readNullableString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  return null;
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Respuesta RPC inválida: ${label} no es boolean.`);
  }
  return value;
}

function readNumber(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error(`Respuesta RPC inválida: ${label} no es número.`);
}

function parseSearchRow(row: unknown): ClientSearchItemV1 {
  const r = asRecord(row);
  return {
    clientId: readString(r.client_id, "client_id"),
    fullName: readString(r.full_name, "full_name"),
    dniNumber: readNullableString(r.dni_number),
    revision: readNumber(r.revision, "revision"),
    logicalDeleted: readBoolean(r.logical_deleted, "logical_deleted"),
    updatedAt: readString(r.updated_at, "updated_at"),
    dniFrontAvailable: readBoolean(r.dni_front_available, "dni_front_available"),
    dniBackAvailable: readBoolean(r.dni_back_available, "dni_back_available"),
  };
}

function parseClientAggregate(payload: unknown): ClientAggregateV1 | null {
  if (payload == null) return null;

  const root = asRecord(payload);
  if (!root.client) return null;

  const client = asRecord(root.client);
  const rawDocuments = Array.isArray(root.documents) ? root.documents : [];

  return {
    id: readString(client.id, "client.id"),
    organizationId: readString(client.organization_id, "client.organization_id"),
    fullName: readString(client.full_name, "client.full_name"),
    dniNumber: readNullableString(client.dni_number),
    revision: readNumber(client.revision, "client.revision"),
    logicalDeleted: readBoolean(client.logical_deleted, "client.logical_deleted"),
    updatedAt: readString(client.updated_at, "client.updated_at"),
    documents: rawDocuments.map((item) => {
      const doc = asRecord(item);
      const versionId = readNullableString(doc.current_version_id);
      const version = versionId
        ? {
          id: versionId,
          bucket: readString(doc.storage_bucket, "document.storage_bucket"),
          path: readString(doc.storage_path, "document.storage_path"),
          mimeType: readString(doc.mime_type, "document.mime_type"),
          sizeBytes: readNumber(doc.size_bytes, "document.size_bytes"),
          sha256: readString(doc.sha256, "document.sha256"),
          createdAt: readString(doc.version_created_at, "document.version_created_at"),
        }
        : null;

      return {
        id: readString(doc.id, "document.id"),
        kind: readString(doc.doc_kind, "document.doc_kind") as ClientDocumentKindV1,
        status: readString(doc.status, "document.status") as ClientAggregateV1["documents"][number]["status"],
        revision: readNumber(doc.revision, "document.revision"),
        logicalDeleted: readBoolean(doc.logical_deleted, "document.logical_deleted"),
        updatedAt: readString(doc.updated_at, "document.updated_at"),
        currentVersion: version,
      };
    }),
  };
}

function parseUpsertResult(payload: unknown): UpsertClientV1Result {
  const r = asRecord(payload);
  return {
    clientId: readString(r.client_id, "client_id"),
    revision: readNumber(r.revision, "revision"),
    updatedAt: readString(r.updated_at, "updated_at"),
  };
}

function parsePrepareUploadResult(payload: unknown): PrepareDocumentUploadV1Result {
  const r = asRecord(payload);
  return {
    clientId: readString(r.client_id, "client_id"),
    documentId: readString(r.document_id, "document_id"),
    documentVersionId: readString(r.document_version_id, "document_version_id"),
    bucket: readString(r.bucket, "bucket"),
    storagePath: readString(r.storage_path, "storage_path"),
    mimeType: readString(r.mime_type, "mime_type"),
    sizeBytes: readNumber(r.size_bytes, "size_bytes"),
  };
}

function parseCommitUploadResult(payload: unknown): CommitDocumentUploadV1Result {
  const r = asRecord(payload);
  return {
    documentId: readString(r.document_id, "document_id"),
    documentVersionId: readString(r.document_version_id, "document_version_id"),
    status: readString(r.status, "status") as CommitDocumentUploadV1Result["status"],
  };
}

function parseChangeRow(row: unknown): ClientChangeEventV1 {
  const r = asRecord(row);
  return {
    aggregateType: readString(r.aggregate_type, "aggregate_type"),
    aggregateId: readString(r.aggregate_id, "aggregate_id"),
    eventType: readString(r.event_type, "event_type"),
    payload: asRecord(r.payload),
    createdAt: readString(r.created_at, "created_at"),
    eventId: readNumber(r.event_id, "event_id"),
  };
}

async function callRpc<T>(name: string, params: Record<string, unknown>): Promise<T> {
  ensureSupabaseConfigured();
  const { data, error } = await supabase.rpc(name, params as never);
  if (error) {
    throw new Error(`RPC ${name} falló: ${error.message}`);
  }
  return data as T;
}

export function createSupabaseClientAggregateV1Repository(): ClientAggregateV1Repository {
  return {
    async get(clientId, includeDeleted = false) {
      const payload = await callRpc<unknown>("rpc_client_get_v1", {
        p_client_id: clientId,
        p_include_deleted: includeDeleted,
      });

      return parseClientAggregate(payload);
    },

    async search(params = {}) {
      const payload = await callRpc<unknown[]>("rpc_client_search_v1", {
        p_query: params.query ?? null,
        p_limit: params.limit ?? 50,
        p_offset: params.offset ?? 0,
        p_include_deleted: params.includeDeleted ?? false,
      });

      if (!Array.isArray(payload)) return [];
      return payload.map(parseSearchRow);
    },

    async upsert(input) {
      const payload = await callRpc<unknown>("rpc_client_upsert_v1", {
        p_client_id: input.clientId ?? null,
        p_full_name: input.fullName,
        p_dni_number: input.dniNumber ?? null,
        p_expected_revision: input.expectedRevision ?? null,
        p_device_id: input.deviceId ?? DEFAULT_DEVICE_ID,
        p_idempotency_key: input.idempotencyKey ?? createIdempotencyKey(),
      });

      return parseUpsertResult(payload);
    },

    async prepareDocumentUpload(input) {
      const payload = await callRpc<unknown>("rpc_document_prepare_upload_v1", {
        p_client_id: input.clientId,
        p_doc_kind: input.docKind,
        p_sha256: input.sha256 ?? null,
        p_mime_type: input.mimeType,
        p_size_bytes: input.sizeBytes,
        p_device_id: input.deviceId ?? DEFAULT_DEVICE_ID,
        p_idempotency_key: input.idempotencyKey ?? createIdempotencyKey(),
      });

      return parsePrepareUploadResult(payload);
    },

    async commitDocumentUpload(input) {
      const payload = await callRpc<unknown>("rpc_document_commit_upload_v1", {
        p_document_id: input.documentId,
        p_document_version_id: input.documentVersionId,
        p_sha256: input.sha256 ?? null,
        p_size_bytes: input.sizeBytes ?? null,
        p_device_id: input.deviceId ?? DEFAULT_DEVICE_ID,
        p_idempotency_key: input.idempotencyKey ?? createIdempotencyKey(),
      });

      return parseCommitUploadResult(payload);
    },

    async listChanges(params) {
      const payload = await callRpc<unknown[]>("rpc_client_list_changes_v1", {
        p_since: params.since,
        p_limit: params.limit ?? 100,
      });

      if (!Array.isArray(payload)) return [];
      return payload.map(parseChangeRow);
    },
  };
}

export const clientAggregateV1Repository = createSupabaseClientAggregateV1Repository();
