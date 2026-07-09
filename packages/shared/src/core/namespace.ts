import { randomId } from "./ids";

export const RESERVED_NAMESPACES = new Set([
  "admin",
  "api",
  "assets",
  "auth",
  "default",
  "login",
  "new",
  "settings",
  "www"
]);

export function normalizeNamespace(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 39);
}

export function namespaceSeedFromEmail(email: string): string {
  const localPart = email.split("@")[0] ?? "";
  const normalized = normalizeNamespace(localPart);
  return normalized.length >= 3 ? normalized : `user-${normalized || randomId("").slice(0, 4)}`;
}

export function validateNamespace(namespace: string): string | null {
  if (namespace.length < 3 || namespace.length > 39) {
    return "Namespace must be between 3 and 39 characters.";
  }
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(namespace)) {
    return "Namespace must use lowercase letters, numbers, and hyphens.";
  }
  if (RESERVED_NAMESPACES.has(namespace)) {
    return "Namespace is reserved.";
  }
  return null;
}

export function namespaceCandidateForEmail(email: string): string {
  const seed = namespaceSeedFromEmail(email);
  return RESERVED_NAMESPACES.has(seed) ? `${seed}-${randomId("").slice(0, 4)}` : seed;
}

export function namespaceCollisionSuffix(): string {
  return randomId("").slice(0, 4);
}
