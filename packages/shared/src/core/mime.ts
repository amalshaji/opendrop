const MIME_BY_EXTENSION: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

export function contentTypeForPath(path: string): string {
  const lower = path.toLowerCase();
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".")) : "";
  return MIME_BY_EXTENSION[ext] ?? "application/octet-stream";
}

export function isTextLike(path: string, contentType = contentTypeForPath(path)): boolean {
  return contentType.startsWith("text/") || contentType.includes("json") || contentType.includes("javascript") || path.endsWith(".svg");
}
