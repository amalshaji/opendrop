export const RESERVED_SLUGS = new Set(["annotations", "api", "assets", "settings", "versions"]);

export function normalizeSlug(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 80);
}

export function validateSlug(slug: string): string | null {
  if (slug.length < 1 || slug.length > 80) {
    return "Slug must be between 1 and 80 characters.";
  }
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) {
    return "Slug must use lowercase letters, numbers, and hyphens.";
  }
  if (RESERVED_SLUGS.has(slug)) {
    return "Slug is reserved.";
  }
  return null;
}
