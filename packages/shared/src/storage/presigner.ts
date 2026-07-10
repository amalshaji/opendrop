import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { DirectUploadRequest, PresignedUploadTarget } from "./interface";

export interface S3DirectUploadPresignerConfig {
  bucket: string;
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

export class S3DirectUploadPresigner {
  private readonly client: S3Client;

  constructor(private readonly config: S3DirectUploadPresignerConfig) {
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      requestChecksumCalculation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    });
  }

  async presignPutObject(request: DirectUploadRequest): Promise<PresignedUploadTarget> {
    const expiresInSeconds = Math.max(1, Math.floor(request.expiresInSeconds));
    const headers = {
      "cache-control": "private, no-store",
      "content-type": request.contentType,
      "if-none-match": "*",
      "x-amz-meta-sha256": request.sha256
    };
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: request.key,
        ContentType: request.contentType,
        CacheControl: headers["cache-control"],
        IfNoneMatch: headers["if-none-match"],
        Metadata: { sha256: request.sha256 }
      }),
      {
        expiresIn: expiresInSeconds,
        signableHeaders: new Set(["cache-control", "content-type", "if-none-match"]),
        unhoistableHeaders: new Set(["x-amz-meta-sha256"])
      }
    );
    return {
      url,
      method: "PUT",
      headers,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString()
    };
  }
}
