import { describe, expect, it } from "vitest";
import { R2ArtifactStorage, S3ArtifactStorage, type R2BucketLike } from "../../packages/shared/src/storage";

const request = {
  key: "artifacts/team/demo/ver_1/index.html",
  contentType: "text/html; charset=utf-8",
  sha256: "a".repeat(64),
  expiresInSeconds: 300
};

describe("direct upload storage signing", () => {
  it("uses the narrowly scoped public presign endpoint without exposing the secret", async () => {
    const storage = new S3ArtifactStorage({
      bucket: "opendrop",
      endpoint: "http://minio:9000",
      presignEndpoint: "https://uploads.example.test",
      region: "us-east-1",
      accessKeyId: "opendrop",
      secretAccessKey: "never-expose-this",
      forcePathStyle: true
    });

    const target = await storage.directUpload!.presignPutObject(request);

    expect(new URL(target.url).origin).toBe("https://uploads.example.test");
    expect(target.url).toContain("artifacts/team/demo/ver_1/index.html");
    expect(target.url).not.toContain("never-expose-this");
    expect(target.url).not.toContain("x-amz-checksum");
    expect(new URL(target.url).searchParams.get("X-Amz-SignedHeaders")).toBe("cache-control;content-type;host;if-none-match;x-amz-meta-sha256");
    expect(target.headers).toEqual({
      "cache-control": "private, no-store",
      "content-type": "text/html; charset=utf-8",
      "if-none-match": "*",
      "x-amz-meta-sha256": "a".repeat(64)
    });
  });

  it("keeps R2 direct uploads disabled until S3 API credentials are configured", async () => {
    const storage = new R2ArtifactStorage(emptyBucket);
    expect(storage.directUpload).toBeUndefined();
  });
});

const emptyBucket: R2BucketLike = {
  put: async () => undefined,
  get: async () => null,
  list: async () => ({ objects: [], truncated: false }),
  delete: async () => undefined
};
