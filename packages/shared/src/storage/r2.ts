import type { ArtifactObject, ArtifactStorage, DirectUploadRequest, PresignedUploadTarget } from "./interface";
import { S3DirectUploadPresigner, type S3DirectUploadPresignerConfig } from "./presigner";

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

export interface R2DirectUploadConfig {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export class R2ArtifactStorage implements ArtifactStorage {
  readonly directUploadEnabled: boolean;
  private readonly presigner?: S3DirectUploadPresigner;

  constructor(private bucket: R2BucketLike, directUpload?: R2DirectUploadConfig) {
    this.directUploadEnabled = Boolean(directUpload);
    if (directUpload) {
      const config: S3DirectUploadPresignerConfig = {
        bucket: directUpload.bucket,
        endpoint: `https://${directUpload.accountId}.r2.cloudflarestorage.com`,
        region: "auto",
        accessKeyId: directUpload.accessKeyId,
        secretAccessKey: directUpload.secretAccessKey,
        forcePathStyle: true
      };
      this.presigner = new S3DirectUploadPresigner(config);
    }
  }

  async putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.bucket.put(key, body, {
      httpMetadata: {
        contentType,
        cacheControl: "private, no-store"
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

  async presignPutObject(request: DirectUploadRequest): Promise<PresignedUploadTarget> {
    if (!this.presigner) throw new Error("Direct upload signing is not configured for R2.");
    return this.presigner.presignPutObject(request);
  }
}
