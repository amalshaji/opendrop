export function normalizeArtifactPath(path: string): string | null {
  const clean = path.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = clean.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") return null;
    if (part.includes("\0")) return null;
    out.push(part);
  }
  if (out.length === 0) return null;
  return out.join("/");
}

export function pagePathToArtifactPath(path: string): string {
  const withoutQuery = path.split("?")[0] ?? "/";
  const normalized = normalizeArtifactPath(withoutQuery === "/" ? "index.html" : withoutQuery);
  if (!normalized) return "index.html";
  return normalized.endsWith("/") ? `${normalized}index.html` : normalized;
}

export function storageKey(namespace: string, slug: string, versionId: string, path: string): string {
  return `artifacts/${namespace}/${slug}/${versionId}/${path}`;
}
