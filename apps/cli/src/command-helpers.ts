import { deploymentTargetSchema } from "@opendrop/shared/core";

export function parseDeploymentTarget(target: string): { namespace: string; slug: string; versionId?: string } {
  const parsed = deploymentTargetSchema.safeParse(target);
  if (!parsed.success) throw new Error("Expected namespace/slug or preview URL. " + validationMessage(parsed.error));
  return parsed.data;
}

export function searchParams(values: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string") params.set(key, value);
  }
  return params;
}

export function validationMessage(error: unknown): string {
  const issues = typeof error === "object" && error !== null && "issues" in error ? (error as { issues?: unknown }).issues : null;
  if (!Array.isArray(issues)) return String(error);
  return issues
    .map((issue) => {
      const item = issue as { path?: Array<string | number>; message?: string };
      return `${item.path?.join(".") || "value"}: ${item.message ?? "Invalid value."}`;
    })
    .join("; ");
}
