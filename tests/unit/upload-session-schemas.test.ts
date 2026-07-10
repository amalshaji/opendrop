import { describe, expect, it } from "vitest";
import {
  DEFAULT_VALIDATION_LIMITS,
  DIRECT_UPLOAD_MANIFEST_MAX_BYTES,
  isDirectUploadFallbackCode,
  publishResultWithValidation,
  serializedUploadManifestBytes,
  uploadSessionCreateBodySchema,
  uploadSessionUrlsBodySchema,
  type ValidationResult
} from "../../packages/shared/src/core";

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

  it("rejects serialized manifests above the D1-safe persistence cap", () => {
    const manifest = [entry, ...Array.from({ length: 600 }, (_, index) => ({
      path: `assets/${index}-${"x".repeat(1_700)}.bin`,
      size: 0,
      sha256: "b".repeat(64),
      contentType: "application/octet-stream"
    }))];
    expect(serializedUploadManifestBytes(manifest)).toBeGreaterThan(DIRECT_UPLOAD_MANIFEST_MAX_BYTES);
    expect(uploadSessionCreateBodySchema.safeParse({ manifest }).success).toBe(false);
  });

  it("preserves local skipped files and issues in the direct publish result", () => {
    const validation: ValidationResult = {
      ok: true,
      hasIndexHtml: true,
      acceptedFiles: [entry],
      skippedFiles: [{ ...entry, path: "large.html" }],
      issues: [{ code: "file_too_large", severity: "skipped", path: "large.html", message: "Skipped." }],
      totalAcceptedBytes: 4,
      totalSkippedBytes: 4,
      totalLineCount: 1
    };
    const result = publishResultWithValidation({ url: "/team/demo", validation: { stale: true } }, validation);
    expect(result.validation.skippedFiles).toHaveLength(1);
    expect(result.validation.issues[0]?.code).toBe("file_too_large");
  });

  it("allows fallback only for explicit pre-session capability codes", () => {
    expect(isDirectUploadFallbackCode("direct_upload_unavailable")).toBe(true);
    expect(isDirectUploadFallbackCode("direct_upload_manifest_too_large")).toBe(true);
    expect(isDirectUploadFallbackCode("upload_session_finalizing")).toBe(false);
    expect(isDirectUploadFallbackCode("storage_failed")).toBe(false);
  });
});
