import type { ArtifactObject, ArtifactStorage } from "./interface";

export interface R2ObjectBodyLike {
  body: ReadableStream<Uint8Array>;
  httpMetadata?: {
    contentType?: string;
  };
  size?: number;
}

export interface R2BucketLike {
  put(key: string, body: Uint8Array, options?: { httpMetadata?: { contentType?: string; cacheControl?: string } }): Promise<unknown>;
  get(key: string): Promise<R2ObjectBodyLike | null>;
  list(options: { prefix: string; cursor?: string }): Promise<{ objects: Array<{ key: string }>; cursor?: string; truncated: boolean }>;
  delete(keys: string[]): Promise<void>;
}

export class R2ArtifactStorage implements ArtifactStorage {
  constructor(private bucket: R2BucketLike) {}

  async putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.bucket.put(key, body, {
      httpMetadata: {
        contentType,
        cacheControl: "public, max-age=31536000, immutable"
      }
    });
  }

  async getObject(key: string): Promise<ArtifactObject | null> {
    const object = await this.bucket.get(key);
    if (!object) return null;
    return {
      body: object.body,
      contentType: object.httpMetadata?.contentType ?? "application/octet-stream",
      size: object.size
    };
  }

  async deletePrefix(prefix: string): Promise<void> {
    let cursor: string | undefined;
    do {
      const listed = await this.bucket.list({ prefix, cursor });
      if (listed.objects.length > 0) {
        await this.bucket.delete(listed.objects.map((object) => object.key));
      }
      cursor = listed.cursor;
      if (!listed.truncated) break;
    } while (cursor);
  }
}
