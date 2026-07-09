import type { OpenDropRepository } from "../db/repository";
import { createRawCliToken, hashToken } from "../db/tokens";
import type { UserRecord } from "../db/types";
import { emailAllowed, type OpenDropAuthConfig } from "./config";
import { readTrustedHeaderIdentity, type TrustedHeaderSource } from "./trusted-headers";

export interface AuthenticatedUser {
  user: UserRecord;
  authMode: "oauth" | "session" | "cli-token" | "trusted-header" | "dev";
}

export class AuthRejectedError extends Error {
  constructor(
    message: string,
    public readonly status = 403
  ) {
    super(message);
    this.name = "AuthRejectedError";
  }
}

export async function authenticateRequest(
  request: Request,
  source: string | TrustedHeaderSource | null,
  repo: OpenDropRepository,
  config: OpenDropAuthConfig
): Promise<AuthenticatedUser | null> {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) {
    const user = await repo.getUserByCliTokenHash(await hashToken(bearer));
    if (user) return authenticatedTokenUser(user, "cli-token", config);
  }

  const sessionToken = readCookie(request.headers.get("cookie") ?? "", "od_session");
  if (sessionToken) {
    const user = await repo.getUserByCliTokenHash(await hashToken(sessionToken));
    if (user) return authenticatedTokenUser(user, "session", config);
  }

  const trusted = readTrustedHeaderIdentity(request.headers, source, config);
  if (trusted.error) {
    throw new AuthRejectedError(trusted.error);
  }
  if (trusted.identity) {
    const provider = config.authMode === "dev" ? "dev" : "trusted-header";
    if (!config.trustedHeader?.autoProvision) {
      const existingUser = await repo.getUserByIdentity(provider, trusted.identity.subject);
      if (existingUser) return { user: existingUser, authMode: provider };
      throw new AuthRejectedError("Account not provisioned.");
    }
    if (config.trustedHeader?.allowEmailLinking) {
      const linkedUser = await repo.linkIdentityToEmail({
        provider,
        subject: trusted.identity.subject,
        email: trusted.identity.email,
        name: trusted.identity.name,
        avatarUrl: trusted.identity.avatarUrl
      });
      if (linkedUser) return { user: linkedUser, authMode: provider };
    }
    const user = await repo.getOrCreateUser({
      provider,
      subject: trusted.identity.subject,
      email: trusted.identity.email,
      name: trusted.identity.name,
      avatarUrl: trusted.identity.avatarUrl
    });
    return { user, authMode: provider };
  }

  return null;
}

function authenticatedTokenUser(user: UserRecord, authMode: "cli-token" | "session", config: OpenDropAuthConfig): AuthenticatedUser {
  if (!emailAllowed(user.email, config.allowedEmailDomains)) {
    throw new AuthRejectedError("Email domain is not allowed.");
  }
  return { user, authMode };
}

export async function createSessionForUser(repo: OpenDropRepository, userId: string, label: string): Promise<string> {
  const token = createRawCliToken();
  await repo.createCliToken(userId, await hashToken(token), label);
  return token;
}

export function sessionCookie(token: string, maxAgeSeconds = 60 * 60 * 24 * 30): string {
  return `od_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function readCookie(cookieHeader: string, name: string): string | null {
  const parts = cookieHeader.split(";").map((part) => part.trim());
  for (const part of parts) {
    const [key, ...valueParts] = part.split("=");
    if (key === name) return decodeURIComponent(valueParts.join("="));
  }
  return null;
}
