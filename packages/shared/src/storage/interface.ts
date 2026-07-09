export interface ArtifactObject {
  body: ReadableStream<Uint8Array> | Uint8Array;
  contentType: string;
  size?: number;
}

export interface ArtifactStorage {
  putObject(key: string, body: Uint8Array, contentType: string): Promise<void>;
  getObject(key: string): Promise<ArtifactObject | null>;
  deletePrefix(prefix: string): Promise<void>;
}
