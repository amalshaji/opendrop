import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { R2ArtifactStorage, S3ArtifactStorage, type ArtifactStorage, type R2BucketLike } from "../../packages/shared/src/storage";

const s3Endpoint = process.env.OPENDROP_S3_TEST_ENDPOINT;
const describeS3 = s3Endpoint ? describe : describe.skip;

describeS3("s3-compatible storage contract", () => {
  it("stores, reads, and deletes artifact objects in MinIO/S3", async () => {
    const storage = new S3ArtifactStorage({
      endpoint: s3Endpoint,
      bucket: process.env.OPENDROP_S3_TEST_BUCKET || "opendrop",
      region: "us-east-1",
      accessKeyId: process.env.OPENDROP_S3_TEST_ACCESS_KEY_ID || "opendrop",
      secretAccessKey: process.env.OPENDROP_S3_TEST_SECRET_ACCESS_KEY || "opendrop-secret",
      forcePathStyle: true
    });
    await expectArtifactStorageContract(storage);
  });
});

describe("r2 storage contract", () => {
  it("stores, reads, and deletes artifact objects with an R2 bucket binding", async () => {
    await expectArtifactStorageContract(new R2ArtifactStorage(new MemoryR2Bucket()));
  });
});

async function expectArtifactStorageContract(storage: ArtifactStorage): Promise<void> {
  const prefix = `contracts/${randomUUID()}/`;
  const firstKey = `${prefix}index.html`;
  const secondKey = `${prefix}assets/app.css`;
  await storage.putObject(firstKey, new TextEncoder().encode("<h1>Hello</h1>"), "text/html");
  await storage.putObject(secondKey, new TextEncoder().encode("h1 { color: green; }"), "text/css");

  const first = await storage.getObject(firstKey);
  expect(first?.contentType).toBe("text/html");
  expect(await objectText(first?.body)).toBe("<h1>Hello</h1>");
  expect((await storage.getObject(secondKey))?.contentType).toBe("text/css");

  await storage.deletePrefix(prefix);
  expect(await storage.getObject(firstKey)).toBeNull();
  expect(await storage.getObject(secondKey)).toBeNull();
}

async function objectText(body: ReadableStream<Uint8Array> | Uint8Array | undefined): Promise<string> {
  if (!body) return "";
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  return new Response(body).text();
}

class MemoryR2Bucket implements R2BucketLike {
  private objects = new Map<string, { body: Uint8Array; contentType?: string }>();

  async put(key: string, body: Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown> {
    this.objects.set(key, { body, contentType: options?.httpMetadata?.contentType });
    return undefined;
  }

  async get(key: string) {
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      body: new Response(object.body).body!,
      httpMetadata: { contentType: object.contentType },
      size: object.body.byteLength
    };
  }

  async list(options: { prefix: string; cursor?: string }) {
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(options.prefix)).sort();
    const offset = options.cursor ? Number(options.cursor) : 0;
    const page = keys.slice(offset, offset + 2);
    const nextOffset = offset + page.length;
    return {
      objects: page.map((key) => ({ key })),
      cursor: nextOffset < keys.length ? String(nextOffset) : undefined,
      truncated: nextOffset < keys.length
    };
  }

  async delete(keys: string[]): Promise<void> {
    for (const key of keys) this.objects.delete(key);
  }
}
