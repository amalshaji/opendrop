import type { Visibility } from "@opendrop/shared/core";

const ARTIFACT_SANDBOX_CSP = "sandbox allow-scripts";
const PASSIVE_DOCUMENT_SANDBOX_CSP = "sandbox";

export function artifactCacheControl(visibility: Visibility, immutable = false): string {
  if (visibility === "private") return "private, no-store";
  return immutable ? "public, max-age=31536000, immutable" : "public, max-age=60, must-revalidate";
}

export function artifactResponseHeaders(contentType: string, cacheControl: string): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": contentType,
    "cache-control": cacheControl,
    "x-content-type-options": "nosniff",
    "cross-origin-resource-policy": "same-origin"
  };
  if (isHtmlContentType(contentType)) {
    headers["content-security-policy"] = ARTIFACT_SANDBOX_CSP;
  } else if (isSvgContentType(contentType)) {
    headers["content-security-policy"] = PASSIVE_DOCUMENT_SANDBOX_CSP;
  }
  return headers;
}

export async function streamToText(body: ReadableStream<Uint8Array> | Uint8Array): Promise<string> {
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  return new Response(body).text();
}

export function artifactBody(body: ReadableStream<Uint8Array> | Uint8Array): BodyInit {
  if (body instanceof Uint8Array) {
    return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
  }
  return body;
}

function isHtmlContentType(contentType: string): boolean {
  const mediaType = contentType.toLowerCase().split(";")[0]?.trim();
  return mediaType === "text/html" || mediaType === "application/xhtml+xml";
}

function isSvgContentType(contentType: string): boolean {
  return contentType.toLowerCase().split(";")[0]?.trim() === "image/svg+xml";
}
