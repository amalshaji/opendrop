const ARTIFACT_SANDBOX_CSP = "sandbox allow-scripts allow-forms allow-popups";

export function artifactResponseHeaders(contentType: string, cacheControl: string): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": contentType,
    "cache-control": cacheControl,
    "x-content-type-options": "nosniff"
  };
  if (isHtmlContentType(contentType)) headers["content-security-policy"] = ARTIFACT_SANDBOX_CSP;
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
