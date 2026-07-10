import type { Visibility } from "./types";
import { normalizeUploadRoot, validateUploadFiles, type UploadFileLike } from "./validation";
import {
  DIRECT_UPLOAD_URL_BATCH_MAX,
  isDirectUploadFallbackCode,
  publishResultSchema,
  uploadSessionCreateResponseSchema,
  uploadSessionUrlsResponseSchema,
  type PublishResult
} from "./upload-sessions";
import type { ValidationResult } from "./types";
import { mapWithConcurrency } from "./concurrency";

export interface PreparedUpload {
  validation: ValidationResult;
  bytesByPath: ReadonlyMap<string, Uint8Array>;
}

export interface DirectUploadTransport {
  request(path: string, init: RequestInit): Promise<Response>;
  put?(url: string, init: RequestInit): Promise<Response>;
}

export type DirectUploadResult =
  | { kind: "published"; result: PublishResult }
  | { kind: "unavailable" };

export async function prepareDirectUpload(files: UploadFileLike[]): Promise<PreparedUpload> {
  const normalized = normalizeUploadRoot(files);
  return {
    validation: await validateUploadFiles(normalized),
    bytesByPath: new Map(normalized.map((file) => [file.path, file.bytes]))
  };
}

export async function runDirectUpload(
  prepared: PreparedUpload,
  metadata: { namespace?: string; slug?: string; visibility?: Visibility },
  transport: DirectUploadTransport,
  onProgress?: (completed: number, total: number) => void
): Promise<DirectUploadResult> {
  if (!prepared.validation.ok) {
    throw new Error(prepared.validation.issues.map((issue) => issue.message).join(" "));
  }
  const createResponse = await transport.request("/api/uploads/sessions", jsonRequest("POST", {
    ...metadata,
    manifest: prepared.validation.acceptedFiles
  }));
  if (!createResponse.ok) {
    const body = await errorBody(createResponse);
    if ([413, 501, 503].includes(createResponse.status) && isDirectUploadFallbackCode(body?.code)) {
      return { kind: "unavailable" };
    }
    throw responseError(createResponse, body, "Upload session creation failed.");
  }

  const session = uploadSessionCreateResponseSchema.parse(await createResponse.json());
  for (let offset = 0; offset < prepared.validation.acceptedFiles.length; offset += DIRECT_UPLOAD_URL_BATCH_MAX) {
    const paths = prepared.validation.acceptedFiles
      .slice(offset, offset + DIRECT_UPLOAD_URL_BATCH_MAX)
      .map((file) => file.path);
    const urlsResponse = await transport.request(
      `/api/uploads/sessions/${session.sessionId}/urls`,
      jsonRequest("POST", { paths })
    );
    if (!urlsResponse.ok) throw responseError(urlsResponse, await errorBody(urlsResponse), "Upload URL creation failed.");
    const targets = uploadSessionUrlsResponseSchema.parse(await urlsResponse.json());
    await mapWithConcurrency(targets.uploads, 4, async (target) => {
      const bytes = prepared.bytesByPath.get(target.path);
      if (!bytes) throw new Error(`Missing bytes for ${target.path}`);
      const response = await (transport.put ?? fetch)(target.url, {
        method: "PUT",
        headers: target.headers,
        body: bytesToArrayBuffer(bytes)
      });
      if (!response.ok) throw responseError(response, null, `Direct upload failed for ${target.path}.`);
    }, (completed) => onProgress?.(offset + completed, prepared.validation.acceptedFiles.length));
  }

  const finalizeResponse = await transport.request(`/api/uploads/sessions/${session.sessionId}/finalize`, { method: "POST" });
  if (!finalizeResponse.ok) throw responseError(finalizeResponse, await errorBody(finalizeResponse), "Upload finalization failed.");
  const result = publishResultSchema.parse(await finalizeResponse.json());
  return { kind: "published", result: { ...result, validation: prepared.validation } };
}

function jsonRequest(method: "POST", body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  };
}

async function errorBody(response: Response): Promise<{ code?: string; error?: string } | null> {
  return response.clone().json().catch(() => null) as Promise<{ code?: string; error?: string } | null>;
}

function responseError(response: Response, body: { error?: string } | null, fallback: string): Error {
  return new Error(body?.error ?? `${fallback} (${response.status} ${response.statusText})`);
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
