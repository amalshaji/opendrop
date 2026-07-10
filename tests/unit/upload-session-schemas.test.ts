import { describe, expect, it } from "vitest";
import { DEFAULT_VALIDATION_LIMITS, uploadSessionCreateBodySchema, uploadSessionUrlsBodySchema } from "../../packages/shared/src/core";

const entry = {
  path: "index.html",
  size: 4,
  sha256: "a".repeat(64),
  contentType: "text/html; charset=utf-8",
  lineCount: 1
};

describe("upload session schemas", () => {
  it("accepts a bounded normalized manifest", () => {
    expect(uploadSessionCreateBodySchema.parse({ slug: "demo", manifest: [entry] }).manifest).toEqual([entry]);
  });

  it("rejects unsafe, duplicate, oversized, and non-canonical manifests", () => {
    expect(uploadSessionCreateBodySchema.safeParse({ manifest: [{ ...entry, path: "../index.html" }] }).success).toBe(false);
    expect(uploadSessionCreateBodySchema.safeParse({ manifest: [entry, entry] }).success).toBe(false);
    expect(uploadSessionCreateBodySchema.safeParse({ manifest: [{ ...entry, size: DEFAULT_VALIDATION_LIMITS.maxFileBytes + 1 }] }).success).toBe(false);
    expect(uploadSessionCreateBodySchema.safeParse({ manifest: [{ ...entry, contentType: "text/html" }] }).success).toBe(false);
    expect(uploadSessionCreateBodySchema.safeParse({ manifest: [{ ...entry, path: "about.html" }] }).success).toBe(false);
  });

  it("caps each URL batch at 100 recorded paths", () => {
    expect(uploadSessionUrlsBodySchema.safeParse({ paths: Array.from({ length: 100 }, (_, index) => `file-${index}`) }).success).toBe(true);
    expect(uploadSessionUrlsBodySchema.safeParse({ paths: Array.from({ length: 101 }, (_, index) => `file-${index}`) }).success).toBe(false);
  });
});
