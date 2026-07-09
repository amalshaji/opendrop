import { previewRoutePathSchema, type AnnotationShape, type ValidationResult } from "@opendrop/shared/core";
import type { PreviewRoute } from "./types";

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0] || "Dev User";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

export function validationMessage(error: unknown): string {
  const issues = typeof error === "object" && error !== null && "issues" in error ? (error as { issues?: unknown }).issues : null;
  if (!Array.isArray(issues)) return "Invalid input.";
  return issues
    .map((issue) => {
      const item = issue as { path?: Array<string | number>; message?: string };
      return `${item.path?.join(".") || "value"}: ${item.message ?? "Invalid value."}`;
    })
    .join("; ");
}

export function relativeTime(value: string): string {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString();
}

export function shapeLabel(shape: AnnotationShape): string {
  if (shape.type === "pin") return "Pinned note";
  if (shape.type === "highlight") return "Highlight";
  if (shape.type === "region") return "Region";
  if (shape.type === "freehand") return "Sketch";
  return "Note";
}

export function statusTone(status: string): "idle" | "info" | "success" | "warning" | "danger" {
  if (!status || /idle|checking/i.test(status)) return "idle";
  if (/failed|invalid|error|not available|not found/i.test(status)) return "danger";
  if (/needs|warning|pending/i.test(status)) return "warning";
  if (/ready|published|signed in|copied|saved|approved|created|added|resolved|reopened/i.test(status)) return "success";
  return "info";
}

export function manifestRows(validation: ValidationResult) {
  return [
    ...validation.acceptedFiles.map((file) => ({ ...file, status: "accepted" as const })),
    ...validation.skippedFiles.map((file) => ({ ...file, status: "skipped" as const }))
  ]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => ({
      ...file,
      depth: Math.max(0, file.path.split("/").length - 1)
    }));
}

export function parsePreviewRoute(pathname: string, search: string): PreviewRoute | null {
  const parsed = previewRoutePathSchema.safeParse(pathname);
  if (!parsed.success) return null;
  const route = parsed.data as PreviewRoute;
  const versionId = new URLSearchParams(search).get("version") || route.versionId;
  return versionId ? { ...route, versionId } : route;
}
