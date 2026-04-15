export type ClientDocumentKindV1 = "dni_front" | "dni_back" | "dni_full";

export type ClientDocumentStatusV1 = "pending" | "active" | "superseded" | "deleted";

export interface ClientDocumentVersionV1 {
  id: string;
  bucket: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

export interface ClientDocumentV1 {
  id: string;
  kind: ClientDocumentKindV1;
  status: ClientDocumentStatusV1;
  revision: number;
  logicalDeleted: boolean;
  updatedAt: string;
  currentVersion: ClientDocumentVersionV1 | null;
}

export interface ClientAggregateV1 {
  id: string;
  organizationId: string;
  fullName: string;
  dniNumber: string | null;
  revision: number;
  logicalDeleted: boolean;
  updatedAt: string;
  documents: ClientDocumentV1[];
}

export interface ClientSearchItemV1 {
  clientId: string;
  fullName: string;
  dniNumber: string | null;
  revision: number;
  logicalDeleted: boolean;
  updatedAt: string;
  dniFrontAvailable: boolean;
  dniBackAvailable: boolean;
}

export interface UpsertClientV1Input {
  clientId?: string | null;
  fullName: string;
  dniNumber?: string | null;
  expectedRevision?: number | null;
  deviceId?: string;
  idempotencyKey?: string;
}

export interface UpsertClientV1Result {
  clientId: string;
  revision: number;
  updatedAt: string;
}

export interface PrepareDocumentUploadV1Input {
  clientId: string;
  docKind: ClientDocumentKindV1;
  sha256?: string;
  mimeType: string;
  sizeBytes: number;
  deviceId?: string;
  idempotencyKey?: string;
}

export interface PrepareDocumentUploadV1Result {
  clientId: string;
  documentId: string;
  documentVersionId: string;
  bucket: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
}

export interface CommitDocumentUploadV1Input {
  documentId: string;
  documentVersionId: string;
  sha256?: string;
  sizeBytes?: number;
  deviceId?: string;
  idempotencyKey?: string;
}

export interface CommitDocumentUploadV1Result {
  documentId: string;
  documentVersionId: string;
  status: ClientDocumentStatusV1;
}

export interface ClientChangeEventV1 {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
  eventId: number;
}

export interface ListClientChangesV1Params {
  since: string;
  limit?: number;
}

export interface SearchClientsV1Params {
  query?: string;
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
}
