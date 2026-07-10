export interface ArtifactObject {
  body: ReadableStream<Uint8Array> | Uint8Array;
  contentType: string;
  size?: number;
}

export interface DirectUploadRequest {
  key: string;
  contentType: string;
  sha256: string;
  expiresInSeconds: number;
}

export interface PresignedUploadTarget {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: string;
}

export interface ArtifactStorage {
  readonly directUploadEnabled?: boolean;
  putObject(key: string, body: Uint8Array, contentType: string): Promise<void>;
  getObject(key: string): Promise<ArtifactObject | null>;
  deletePrefix(prefix: string): Promise<void>;
  presignPutObject?(request: DirectUploadRequest): Promise<PresignedUploadTarget>;
}
