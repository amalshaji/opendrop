import { describe, expect, it } from "vitest";
import { AuthRejectedError, authenticateRequest, loadAuthConfig, type AuthenticatedUser } from "@opendrop/shared/auth";
import type { OpenDropRepository } from "@opendrop/shared/db/repository";
import type { UserRecord } from "@opendrop/shared/db/types";

const user: UserRecord = {
  id: "usr_known",
  email: "known@example.com",
  name: "Known User",
  avatarUrl: null,
  defaultNamespace: "known",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

describe("request auth", () => {
  it("authenticates a provisioned trusted-header identity when auto-provisioning is disabled", async () => {
    const auth = await authenticateRequest(trustedRequest("known@example.com"), "127.0.0.1", repoWithIdentity(user), trustedConfig());
    expect((auth as AuthenticatedUser).user.id).toBe(user.id);
    expect(auth?.authMode).toBe("trusted-header");
  });

  it("rejects an unknown trusted-header identity clearly when auto-provisioning is disabled", async () => {
    await expect(authenticateRequest(trustedRequest("missing@example.com"), "127.0.0.1", repoWithIdentity(null), trustedConfig())).rejects.toMatchObject({
      name: "AuthRejectedError",
      message: "Account not provisioned.",
      status: 403
    } satisfies Partial<AuthRejectedError>);
  });

  it("rejects spoofed trusted identity headers from untrusted sources", async () => {
    await expect(authenticateRequest(trustedRequest("known@example.com"), "203.0.113.10", repoWithIdentity(user), trustedConfig())).rejects.toMatchObject({
      name: "AuthRejectedError",
      message: expect.stringMatching(/untrusted/i),
      status: 403
    } satisfies Partial<AuthRejectedError>);
  });

  it("keeps ordinary requests without trusted identity headers anonymous", async () => {
    const auth = await authenticateRequest(new Request("https://drop.example.test/api/session"), "203.0.113.10", repoWithIdentity(user), trustedConfig());
    expect(auth).toBeNull();
  });

  it("uses explicit email-based linking when trusted-header linking is enabled", async () => {
    const auth = await authenticateRequest(
      trustedRequest("known@example.com"),
      "127.0.0.1",
      {
        getUserByCliTokenHash: async () => null,
        linkIdentityToEmail: async () => user,
        getOrCreateUser: async () => {
          throw new Error("getOrCreateUser should not be called after linking");
        }
      } as unknown as OpenDropRepository,
      trustedConfig({ TRUSTED_HEADER_AUTO_PROVISION: "true", TRUSTED_HEADER_ALLOW_EMAIL_LINKING: "true" })
    );
    expect(auth?.user.id).toBe(user.id);
    expect(auth?.authMode).toBe("trusted-header");
  });

  it("rejects CLI tokens when the stored user email no longer passes domain restrictions", async () => {
    await expect(
      authenticateRequest(
        new Request("https://drop.example.test/api/session", {
          headers: { authorization: "Bearer raw-token" }
        }),
        null,
        repoWithTokenUser(user),
        trustedConfig({ OPENDROP_ALLOWED_EMAIL_DOMAINS: "company.test" })
      )
    ).rejects.toMatchObject({
      name: "AuthRejectedError",
      message: expect.stringMatching(/domain/i),
      status: 403
    } satisfies Partial<AuthRejectedError>);
  });

  it("rejects browser session tokens when the stored user email no longer passes domain restrictions", async () => {
    await expect(
      authenticateRequest(
        new Request("https://drop.example.test/api/session", {
          headers: { cookie: "od_session=raw-session-token" }
        }),
        null,
        repoWithTokenUser(user),
        trustedConfig({ OPENDROP_ALLOWED_EMAIL_DOMAINS: "company.test" })
      )
    ).rejects.toMatchObject({
      name: "AuthRejectedError",
      message: expect.stringMatching(/domain/i),
      status: 403
    } satisfies Partial<AuthRejectedError>);
  });
});

function trustedConfig(overrides: Record<string, string> = {}) {
  return loadAuthConfig({
    OPENDROP_AUTH_MODE: "trusted-header",
    TRUSTED_HEADER_AUTO_PROVISION: "false",
    TRUSTED_PROXY_CIDRS: "127.0.0.1/32",
    TRUSTED_HEADER_EMAIL: "x-email",
    TRUSTED_HEADER_USER_ID: "x-user-id",
    ...overrides
  });
}

function trustedRequest(email: string): Request {
  return new Request("https://drop.example.test/api/session", {
    headers: {
      "x-email": email,
      "x-user-id": `subject:${email}`
    }
  });
}

function repoWithIdentity(record: UserRecord | null): OpenDropRepository {
  return {
    getUserByIdentity: async () => record,
    getUserByCliTokenHash: async () => null
  } as unknown as OpenDropRepository;
}

function repoWithTokenUser(record: UserRecord): OpenDropRepository {
  return {
    getUserByCliTokenHash: async () => record
  } as unknown as OpenDropRepository;
}
