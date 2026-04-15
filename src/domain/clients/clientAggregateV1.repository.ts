import type {
  ClientAggregateV1,
  ClientChangeEventV1,
  ClientSearchItemV1,
  CommitDocumentUploadV1Input,
  CommitDocumentUploadV1Result,
  ListClientChangesV1Params,
  PrepareDocumentUploadV1Input,
  PrepareDocumentUploadV1Result,
  SearchClientsV1Params,
  UpsertClientV1Input,
  UpsertClientV1Result,
} from "./clientAggregateV1.types";

export interface ClientAggregateV1Repository {
  get(clientId: string, includeDeleted?: boolean): Promise<ClientAggregateV1 | null>;

  search(params?: SearchClientsV1Params): Promise<ClientSearchItemV1[]>;

  upsert(input: UpsertClientV1Input): Promise<UpsertClientV1Result>;

  prepareDocumentUpload(
    input: PrepareDocumentUploadV1Input,
  ): Promise<PrepareDocumentUploadV1Result>;

  commitDocumentUpload(
    input: CommitDocumentUploadV1Input,
  ): Promise<CommitDocumentUploadV1Result>;

  listChanges(params: ListClientChangesV1Params): Promise<ClientChangeEventV1[]>;
}
