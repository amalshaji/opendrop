import { unzipSync } from "fflate";
import { contentTypeForPath, isTextLike } from "./mime";
import { normalizeArtifactPath } from "./paths";
import type { FileManifestEntry, ValidationIssue, ValidationResult } from "./types";

export interface UploadFileLike {
  path: string;
  bytes: Uint8Array;
  contentType?: string;
}

export interface ValidationLimits {
  maxFileBytes: number;
  maxTotalBytes: number;
  maxFiles: number;
  maxTextLines: number;
}

export const DEFAULT_VALIDATION_LIMITS: ValidationLimits = {
  maxFileBytes: 25 * 1024 * 1024,
  maxTotalBytes: 90 * 1024 * 1024,
  maxFiles: 20_000,
  maxTextLines: 25_000
};

export class ZipUploadLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipUploadLimitError";
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", source);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function lineCount(bytes: Uint8Array): number {
  let count = bytes.length > 0 ? 1 : 0;
  for (const byte of bytes) {
    if (byte === 10) count += 1;
  }
  return count;
}

export function filesFromZip(bytes: Uint8Array, limits: ValidationLimits = DEFAULT_VALIDATION_LIMITS): UploadFileLike[] {
  let totalOriginalBytes = 0;
  let entryCount = 0;
  const entries = unzipSync(bytes, {
    filter: (entry) => {
      entryCount += 1;
      if (entryCount > limits.maxFiles) {
        throw new ZipUploadLimitError(`Zip upload has more than ${limits.maxFiles} files.`);
      }
      if (entry.originalSize > limits.maxFileBytes) {
        throw new ZipUploadLimitError(`Zip entry ${entry.name} is larger than ${limits.maxFileBytes} bytes.`);
      }
      totalOriginalBytes += entry.originalSize;
      if (totalOriginalBytes > limits.maxTotalBytes) {
        throw new ZipUploadLimitError(`Zip upload expands beyond ${limits.maxTotalBytes} bytes.`);
      }
      return true;
    }
  });
  return normalizeUploadRoot(Object.entries(entries).map(([path, fileBytes]) => ({
    path,
    bytes: fileBytes
  })));
}

export function normalizeUploadRoot(files: UploadFileLike[]): UploadFileLike[] {
  const paths = files.map((file) => file.path.replace(/\\/g, "/").replace(/^\/+/, ""));
  if (paths.some((path) => path === "index.html")) return files;
  const first = paths[0]?.split("/")[0];
  if (!first) return files;
  const canStrip = paths.every((path) => path.startsWith(`${first}/`) && path.length > first.length + 1);
  const hasNestedIndex = paths.some((path) => path === `${first}/index.html`);
  if (!canStrip || !hasNestedIndex) return files;
  return files.map((file) => ({
    ...file,
    path: file.path.replace(/\\/g, "/").replace(/^\/+/, "").slice(first.length + 1)
  }));
}

export async function validateUploadFiles(
  inputFiles: UploadFileLike[],
  limits: ValidationLimits = DEFAULT_VALIDATION_LIMITS
): Promise<ValidationResult> {
  inputFiles = normalizeUploadRoot(inputFiles);
  const acceptedFiles: FileManifestEntry[] = [];
  const skippedFiles: FileManifestEntry[] = [];
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  let totalAcceptedBytes = 0;
  let totalSkippedBytes = 0;
  let totalLineCount = 0;

  if (inputFiles.length > limits.maxFiles) {
    issues.push({
      code: "too_many_files",
      severity: "warning",
      message: `Upload has ${inputFiles.length} files; only the first ${limits.maxFiles} files will be considered.`
    });
  }

  for (const file of inputFiles.slice(0, limits.maxFiles)) {
    const normalizedPath = normalizeArtifactPath(file.path);
    if (!normalizedPath) {
      issues.push({
        code: "unsafe_path",
        severity: "error",
        path: file.path,
        message: "File path is unsafe."
      });
      continue;
    }
    if (seen.has(normalizedPath)) {
      issues.push({
        code: "duplicate_path",
        severity: "error",
        path: normalizedPath,
        message: "Duplicate normalized path."
      });
      continue;
    }
    seen.add(normalizedPath);

    const contentType = file.contentType || contentTypeForPath(normalizedPath);
    const textLines = isTextLike(normalizedPath, contentType) ? lineCount(file.bytes) : undefined;
    const entry: FileManifestEntry = {
      path: normalizedPath,
      size: file.bytes.byteLength,
      sha256: await sha256Hex(file.bytes),
      contentType,
      ...(textLines === undefined ? {} : { lineCount: textLines })
    };

    if (entry.size > limits.maxFileBytes) {
      skippedFiles.push(entry);
      totalSkippedBytes += entry.size;
      issues.push({
        code: "file_too_large",
        severity: "skipped",
        path: normalizedPath,
        message: `File is larger than ${limits.maxFileBytes} bytes and will be skipped.`
      });
      continue;
    }
    if ((textLines ?? 0) > limits.maxTextLines) {
      skippedFiles.push(entry);
      totalSkippedBytes += entry.size;
      issues.push({
        code: "too_many_lines",
        severity: "skipped",
        path: normalizedPath,
        message: `Text file has more than ${limits.maxTextLines} lines and will be skipped.`
      });
      continue;
    }
    if (totalAcceptedBytes + entry.size > limits.maxTotalBytes) {
      skippedFiles.push(entry);
      totalSkippedBytes += entry.size;
      issues.push({
        code: "total_size_exceeded",
        severity: "skipped",
        path: normalizedPath,
        message: `Accepted files would exceed ${limits.maxTotalBytes} bytes.`
      });
      continue;
    }

    acceptedFiles.push(entry);
    totalAcceptedBytes += entry.size;
    totalLineCount += textLines ?? 0;
  }

  const hasIndexHtml = acceptedFiles.some((file) => file.path === "index.html");
  if (!hasIndexHtml) {
    issues.push({
      code: "missing_index_html",
      severity: "error",
      message: "Upload must contain index.html at the root."
    });
  }
  if (acceptedFiles.length === 0) {
    issues.push({
      code: "empty_manifest",
      severity: "error",
      message: "Upload has no accepted files."
    });
  }

  const hasError = issues.some((issue) => issue.severity === "error");
  return {
    ok: !hasError,
    hasIndexHtml,
    acceptedFiles,
    skippedFiles,
    issues,
    totalAcceptedBytes,
    totalSkippedBytes,
    totalLineCount
  };
}

export async function manifestHash(entries: FileManifestEntry[]): Promise<string> {
  const canonical = JSON.stringify(
    [...entries].sort((a, b) => a.path.localeCompare(b.path)).map((entry) => ({
      path: entry.path,
      sha256: entry.sha256,
      size: entry.size
    }))
  );
  return sha256Hex(new TextEncoder().encode(canonical));
}
