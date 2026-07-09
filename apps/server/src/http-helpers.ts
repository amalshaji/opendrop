import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import type { AuthenticatedUser, OpenDropAuthConfig } from "@opendrop/shared/auth";
import type { OpenDropContext } from "@/app-types";

export function requireAuth(c: OpenDropContext): AuthenticatedUser | Response {
  const authError = c.get("authError");
  if (authError) return c.json({ error: authError.message }, contentfulStatus(authError.status));
  const auth = c.get("user");
  if (!auth) return c.json({ error: "Authentication required." }, 401);
  return auth;
}

export function requireDevMode(c: OpenDropContext, authConfig: OpenDropAuthConfig): true | Response {
  if (authConfig.authMode === "dev") return true;
  return c.text("404 Not Found", 404);
}

export async function jsonObject(c: OpenDropContext): Promise<unknown> {
  return c.req.json().catch(() => ({}));
}

export function queryObject(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url).searchParams.entries());
}

export function validationError(c: OpenDropContext, error: unknown): Response {
  return c.json({ error: "Invalid request.", issues: zodIssues(error) }, 400);
}

export function repositoryMutationError(c: OpenDropContext, error: unknown): Response {
  const message = errorMessage(error);
  if (/only .*owner/i.test(message)) return c.json({ error: message }, 403);
  if (/not found/i.test(message)) return c.json({ error: message }, 404);
  if (/already exists/i.test(message)) return c.json({ error: message }, 409);
  return c.json({ error: message }, 400);
}

export function wantsJson(request: Request): boolean {
  const url = new URL(request.url);
  return url.searchParams.get("json") === "1" || request.headers.get("accept")?.includes("application/json") === true;
}

export function safeReturnTo(returnTo: string | undefined): string {
  if (!returnTo) return "/";
  if (!returnTo.startsWith("/") || returnTo.startsWith("//")) return "/";
  return returnTo;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function contentfulStatus(status: number): ContentfulStatusCode {
  switch (status) {
    case 400:
      return 400;
    case 401:
      return 401;
    case 403:
      return 403;
    default:
      return 403;
  }
}

function zodIssues(error: unknown): Array<{ path: string; message: string }> {
  const issues = typeof error === "object" && error !== null && "issues" in error ? (error as { issues?: unknown }).issues : null;
  if (!Array.isArray(issues)) return [{ path: "", message: errorMessage(error) }];
  return issues.map((issue) => {
    const item = issue as { path?: Array<string | number>; message?: string };
    return {
      path: item.path?.join(".") ?? "",
      message: item.message ?? "Invalid value."
    };
  });
}

export function sourceFromContext(c: OpenDropContext, trustedSourceHost?: string, trustedSourceIp?: string | null): { ip: string | null; host?: string | null } {
  return {
    ip: trustedSourceIp ?? c.env?.incoming?.socket?.remoteAddress ?? null,
    host: trustedSourceHost ?? null
  };
}
