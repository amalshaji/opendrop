import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { ArtifactObject, ArtifactStorage, DirectUploadCapability } from "./interface";
import { S3DirectUploadPresigner } from "./presigner";

export interface S3StorageConfig {
  bucket: string;
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
  presignEndpoint?: string;
}

export class S3ArtifactStorage implements ArtifactStorage {
  readonly directUpload: DirectUploadCapability;
  private client: S3Client;
  private bucket: string;
  private presigner: S3DirectUploadPresigner;

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    });
    this.presigner = new S3DirectUploadPresigner({
      ...config,
      endpoint: config.presignEndpoint ?? config.endpoint
    });
    this.directUpload = { presignPutObject: (request) => this.presigner.presignPutObject(request) };
  }

  async putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: "private, no-store"
      })
    );
  }

  async getObject(key: string): Promise<ArtifactObject | null> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key
      })
    ).catch((error) => {
      if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) return null;
      throw error;
    });
    if (!response) return null;
    return {
      body: response.Body?.transformToWebStream() as ReadableStream<Uint8Array>,
      contentType: response.ContentType ?? "application/octet-stream",
      size: response.ContentLength
    };
  }

  async deletePrefix(prefix: string): Promise<void> {
    let token: string | undefined;
    do {
      const listed = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token
        })
      );
      const objects = (listed.Contents ?? []).map((object) => ({ Key: object.Key }));
      if (objects.length > 0) {
        await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: objects } }));
      }
      token = listed.NextContinuationToken;
    } while (token);
  }

}
