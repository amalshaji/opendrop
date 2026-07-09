import type { Visibility } from "./types";

export function parseVisibility(input: unknown, fallback: Visibility = "public"): Visibility {
  return input === "private" || input === "public" ? input : fallback;
}

export function isPrivateVisibility(visibility: Visibility): boolean {
  return visibility === "private";
}
