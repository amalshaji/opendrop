import { z } from "zod";
import { contentTypeForPath, isTextLike } from "./mime";
import { normalizeArtifactPath } from "./paths";
import { uploadMetadataSchema } from "./schemas";
import { fileManifestEntrySchema, type FileManifestEntry, type ValidationIssue, type ValidationResult } from "./types";
import { DEFAULT_VALIDATION_LIMITS } from "./validation";

export const UPLOAD_SESSION_TTL_MS = 15 * 60 * 1000;
export const DIRECT_UPLOAD_URL_TTL_SECONDS = 5 * 60;
export const DIRECT_UPLOAD_URL_BATCH_MAX = 100;
export const DIRECT_UPLOAD_MANIFEST_MAX_BYTES = 1_000_000;
export const DIRECT_UPLOAD_FALLBACK_CODES = ["direct_upload_unavailable", "direct_upload_manifest_too_large"] as const;

const uploadSessionManifestEntrySchema = fileManifestEntrySchema
  .extend({
    path: z.string().min(1).max(2048),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    contentType: z.string().min(1).max(255)
  })
  .superRefine((entry, ctx) => {
    if (normalizeArtifactPath(entry.path) !== entry.path) {
      ctx.addIssue({ code: "custom", path: ["path"], message: "Path must be normalized and safe." });
    }
    if (entry.size > DEFAULT_VALIDATION_LIMITS.maxFileBytes) {
      ctx.addIssue({ code: "custom", path: ["size"], message: `File exceeds ${DEFAULT_VALIDATION_LIMITS.maxFileBytes} bytes.` });
    }
    if ((entry.lineCount ?? 0) > DEFAULT_VALIDATION_LIMITS.maxTextLines) {
      ctx.addIssue({ code: "custom", path: ["lineCount"], message: `Text file exceeds ${DEFAULT_VALIDATION_LIMITS.maxTextLines} lines.` });
    }
    const expectedContentType = contentTypeForPath(entry.path);
    if (entry.contentType !== expectedContentType) {
      ctx.addIssue({ code: "custom", path: ["contentType"], message: `Content type must be ${expectedContentType}.` });
    }
    const textLike = isTextLike(entry.path, entry.contentType);
    if (textLike && entry.lineCount === undefined) {
      ctx.addIssue({ code: "custom", path: ["lineCount"], message: "Text files must declare a line count." });
    }
    if (!textLike && entry.lineCount !== undefined) {
      ctx.addIssue({ code: "custom", path: ["lineCount"], message: "Binary files cannot declare a line count." });
    }
  });

export const uploadSessionManifestSchema = z
  .array(uploadSessionManifestEntrySchema)
  .min(1)
  .max(DEFAULT_VALIDATION_LIMITS.maxFiles)
  .superRefine((manifest, ctx) => {
    const seen = new Set<string>();
    let totalBytes = 0;
    for (const [index, entry] of manifest.entries()) {
      if (seen.has(entry.path)) {
        ctx.addIssue({ code: "custom", path: [index, "path"], message: "Duplicate path." });
      }
      seen.add(entry.path);
      totalBytes += entry.size;
    }
    if (!seen.has("index.html")) {
      ctx.addIssue({ code: "custom", message: "Upload must contain index.html at the root." });
    }
    if (totalBytes > DEFAULT_VALIDATION_LIMITS.maxTotalBytes) {
      ctx.addIssue({ code: "custom", message: `Upload exceeds ${DEFAULT_VALIDATION_LIMITS.maxTotalBytes} bytes.` });
    }
    if (serializedUploadManifestBytes(manifest) > DIRECT_UPLOAD_MANIFEST_MAX_BYTES) {
      ctx.addIssue({ code: "custom", message: `Serialized manifest exceeds ${DIRECT_UPLOAD_MANIFEST_MAX_BYTES} bytes.` });
    }
  });

export const uploadSessionCreateBodySchema = uploadMetadataSchema.extend({
  manifest: uploadSessionManifestSchema
});

export const uploadSessionParamsSchema = z.object({
  sessionId: z.string().min(1).max(128)
});

export const uploadSessionUrlsBodySchema = z.object({
  paths: z.array(z.string().min(1).max(2048)).min(1).max(DIRECT_UPLOAD_URL_BATCH_MAX)
});

export const directUploadTargetSchema = z.object({
  path: z.string(),
  url: z.string().url(),
  method: z.literal("PUT"),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.string()
});

export const uploadSessionCreateResponseSchema = z.object({
  sessionId: z.string(),
  versionId: z.string(),
  namespace: z.string(),
  slug: z.string(),
  visibility: z.enum(["public", "private"]),
  expiresAt: z.string()
});

export const uploadSessionUrlsResponseSchema = z.object({
  uploads: z.array(directUploadTargetSchema)
});

export type UploadSessionCreateBody = z.infer<typeof uploadSessionCreateBodySchema>;
export type DirectUploadTarget = z.infer<typeof directUploadTargetSchema>;

export function serializedUploadManifestBytes(manifest: unknown): number {
  return new TextEncoder().encode(JSON.stringify(manifest)).byteLength;
}

export function isDirectUploadFallbackCode(code: unknown): boolean {
  return typeof code === "string" && (DIRECT_UPLOAD_FALLBACK_CODES as readonly string[]).includes(code);
}

export function publishResultWithValidation<T extends Record<string, unknown>>(
  result: T,
  validation: ValidationResult
): T & { validation: ValidationResult } {
  return { ...result, validation };
}

export function validationResultForManifest(acceptedFiles: FileManifestEntry[]): ValidationResult {
  const issues: ValidationIssue[] = [];
  return {
    ok: true,
    hasIndexHtml: true,
    acceptedFiles,
    skippedFiles: [],
    issues,
    totalAcceptedBytes: acceptedFiles.reduce((total, file) => total + file.size, 0),
    totalSkippedBytes: 0,
    totalLineCount: acceptedFiles.reduce((total, file) => total + (file.lineCount ?? 0), 0)
  };
}
