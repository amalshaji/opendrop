import { describe, expect, it } from "vitest";
import {
  DEFAULT_VALIDATION_LIMITS,
  DIRECT_UPLOAD_MANIFEST_MAX_BYTES,
  isDirectUploadFallbackCode,
  runDirectUpload,
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

  it("runs the shared client protocol and preserves local validation details", async () => {
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
    const requests: string[] = [];
    let uploaded = false;
    const direct = await runDirectUpload(
      { validation, bytesByPath: new Map([["index.html", new TextEncoder().encode("home")]]) },
      { slug: "demo" },
      {
        request: async (path) => {
          requests.push(path);
          if (path === "/api/uploads/sessions") {
            return Response.json({
              sessionId: "upl_1",
              versionId: "ver_1",
              namespace: "team",
              slug: "demo",
              visibility: "public",
              expiresAt: new Date(Date.now() + 60_000).toISOString()
            }, { status: 201 });
          }
          if (path.endsWith("/urls")) {
            return Response.json({ uploads: [{
              path: "index.html",
              url: "https://storage.example.test/index.html",
              method: "PUT",
              headers: { "content-type": entry.contentType },
              expiresAt: new Date(Date.now() + 60_000).toISOString()
            }] });
          }
          return Response.json(publishResult([]));
        },
        put: async () => {
          uploaded = true;
          return new Response(null, { status: 200 });
        }
      }
    );
    expect(direct.kind).toBe("published");
    if (direct.kind !== "published") throw new Error("Expected publish result.");
    expect(direct.result.validation.skippedFiles).toHaveLength(1);
    expect(direct.result.validation.issues[0]?.code).toBe("file_too_large");
    expect(uploaded).toBe(true);
    expect(requests).toEqual([
      "/api/uploads/sessions",
      "/api/uploads/sessions/upl_1/urls",
      "/api/uploads/sessions/upl_1/finalize"
    ]);
  });

  it("allows fallback only for explicit pre-session capability codes", () => {
    expect(isDirectUploadFallbackCode("direct_upload_unavailable")).toBe(true);
    expect(isDirectUploadFallbackCode("direct_upload_manifest_too_large")).toBe(true);
    expect(isDirectUploadFallbackCode("upload_session_finalizing")).toBe(false);
    expect(isDirectUploadFallbackCode("storage_failed")).toBe(false);
  });
});

function publishResult(skippedFiles: unknown[]) {
  return {
    namespace: "team",
    slug: "demo",
    visibility: "public",
    url: "/team/demo",
    versionUrl: "/team/demo?version=ver_1",
    family: {
      id: "dep_1",
      namespaceId: "nsp_1",
      namespaceName: "team",
      slug: "demo",
      ownerUserId: "usr_1",
      latestVersionId: "ver_1",
      visibility: "public",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString()
    },
    version: {
      id: "ver_1",
      versionNumber: 1,
      createdAt: new Date(0).toISOString(),
      createdByUserId: "usr_1",
      manifestHash: "hash",
      fileCount: 1,
      totalBytes: 4
    },
    validation: {
      ok: true,
      hasIndexHtml: true,
      acceptedFiles: [entry],
      skippedFiles,
      issues: [],
      totalAcceptedBytes: 4,
      totalSkippedBytes: 0,
      totalLineCount: 1
    }
  };
}
