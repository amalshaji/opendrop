import {
  filesFromZip,
  isDirectUploadFallbackCode,
  mapWithConcurrency,
  normalizeUploadRoot,
  uploadSessionCreateResponseSchema,
  uploadSessionUrlsResponseSchema,
  validateUploadFiles,
  publishResultWithValidation,
  type UploadFileLike,
  type Visibility
} from "@opendrop/shared/core";
import type { CliUploadFile } from "@/files";
import { apiFetch, apiFetchRaw } from "@/http";

export type DirectUploadResult =
  | { kind: "published"; result: Record<string, unknown> }
  | { kind: "unavailable" };

export async function publishDirectUpload(
  files: CliUploadFile[],
  metadata: { namespace?: string; slug?: string; visibility?: Visibility },
  server?: string
): Promise<DirectUploadResult> {
  const preparedFiles = prepareFiles(files);
  const validation = await validateUploadFiles(preparedFiles);
  if (!validation.ok) {
    throw new Error(validation.issues.map((issue) => issue.message).join(" "));
  }
  const bytesByPath = new Map(normalizeUploadRoot(preparedFiles).map((file) => [file.path, file.bytes]));
  const createResponse = await apiFetchRaw("/api/uploads/sessions", {
    server,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...metadata, manifest: validation.acceptedFiles })
  });
  if (!createResponse.ok) {
    const body = await createResponse.json().catch(() => null) as { code?: string } | null;
    if ([413, 501, 503].includes(createResponse.status) && isDirectUploadFallbackCode(body?.code)) {
      return { kind: "unavailable" };
    }
    throw await responseError(createResponse, body);
  }
  const session = uploadSessionCreateResponseSchema.parse(await createResponse.json());
  for (let offset = 0; offset < validation.acceptedFiles.length; offset += 100) {
    const paths = validation.acceptedFiles.slice(offset, offset + 100).map((file) => file.path);
    const urlsResponse = await apiFetch(`/api/uploads/sessions/${session.sessionId}/urls`, {
      server,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paths })
    });
    const urls = uploadSessionUrlsResponseSchema.parse(await urlsResponse.json());
    await mapWithConcurrency(urls.uploads, 4, async (target) => {
      const bytes = bytesByPath.get(target.path);
      if (!bytes) throw new Error(`Missing bytes for ${target.path}`);
      const response = await fetch(target.url, {
        method: "PUT",
        headers: target.headers,
        body: bytesToArrayBuffer(bytes)
      });
      if (!response.ok) throw new Error(`Direct upload failed for ${target.path}: ${response.status} ${response.statusText}`);
    });
  }
  const finalizeResponse = await apiFetch(`/api/uploads/sessions/${session.sessionId}/finalize`, {
    server,
    method: "POST"
  });
  return {
    kind: "published",
    result: publishResultWithValidation(await finalizeResponse.json() as Record<string, unknown>, validation)
  };
}

function prepareFiles(files: CliUploadFile[]): UploadFileLike[] {
  if (files.length === 1 && (files[0]!.path.endsWith(".zip") || files[0]!.type === "application/zip")) {
    return filesFromZip(files[0]!.bytes);
  }
  return files.map((file) => ({ path: file.path, bytes: file.bytes, contentType: file.type }));
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function responseError(response: Response, parsedBody: unknown): Promise<Error> {
  const body = parsedBody ?? await response.text();
  return new Error(`${response.status} ${response.statusText}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
}
