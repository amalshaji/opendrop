import { describe, expect, it } from "vitest";
import { createOpenDropApp } from "../../apps/server/src/app";
import { loadAuthConfig } from "@opendrop/shared/auth";
import { namespaceCandidateForEmail } from "@opendrop/shared/core";
import type { OpenDropRepository } from "@opendrop/shared/db/repository";
import type { IdentityInput, UserRecord } from "@opendrop/shared/db/types";
import type { ArtifactStorage } from "@opendrop/shared/storage/interface";
import type { BrowserAuth } from "../../apps/server/src/auth";

describe("trusted-header auth over HTTP", () => {
  it("auto-provisions a trusted identity at the app boundary", async () => {
    const repo = new TrustedHeaderTestRepo();
    const app = createOpenDropApp({
      repo: repo.asRepository(),
      storage: noopStorage,
      browserAuth: noopBrowserAuth,
      authConfig: trustedConfig(),
      trustedSourceIp: "127.0.0.1"
    });

    const response = await app.fetch(
      new Request("https://drop.example.test/api/session", {
        headers: {
          "x-email": "Team.Member@example.com",
          "x-name": "Team Member"
        }
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.authenticated).toBe(true);
    expect(body.authMode).toBe("trusted-header");
    expect(body.user.email).toBe("team.member@example.com");
    expect(body.user.defaultNamespace).toBe("team-member");
    expect(repo.createdUsers).toHaveLength(1);
  });

  it("rejects spoofed test source headers from direct requests", async () => {
    const repo = new TrustedHeaderTestRepo();
    const app = createOpenDropApp({
      repo: repo.asRepository(),
      storage: noopStorage,
      browserAuth: noopBrowserAuth,
      authConfig: trustedConfig()
    });

    const response = await app.fetch(
      new Request("https://drop.example.test/api/session", {
        headers: {
          "x-opendrop-test-source-ip": "127.0.0.1",
          "x-email": "spoof@example.com"
        }
      })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/untrusted/i) });
    expect(repo.createdUsers).toHaveLength(0);
  });

  it("trusts identity headers from a configured Cloudflare runtime host", async () => {
    const repo = new TrustedHeaderTestRepo();
    const app = createOpenDropApp({
      repo: repo.asRepository(),
      storage: noopStorage,
      browserAuth: noopBrowserAuth,
      authConfig: trustedConfig({ TRUSTED_PROXY_HOSTS: "cloudflare-workers" }),
      trustedSourceHost: "cloudflare-workers"
    });

    const response = await app.fetch(
      new Request("https://drop.example.test/api/session", {
        headers: {
          "x-email": "Access.User@example.com"
        }
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      authenticated: true,
      authMode: "trusted-header",
      user: { email: "access.user@example.com", defaultNamespace: "access-user" }
    });
  });

  it("rejects trusted identities outside configured email domains", async () => {
    const repo = new TrustedHeaderTestRepo();
    const app = createOpenDropApp({
      repo: repo.asRepository(),
      storage: noopStorage,
      browserAuth: noopBrowserAuth,
      authConfig: trustedConfig({ OPENDROP_ALLOWED_EMAIL_DOMAINS: "example.com" }),
      trustedSourceIp: "127.0.0.1"
    });

    const response = await app.fetch(
      new Request("https://drop.example.test/api/session", {
        headers: {
          "x-email": "user@other.test"
        }
      })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/domain/i) });
    expect(repo.createdUsers).toHaveLength(0);
  });

  it("reports configured OAuth providers to the web shell", async () => {
    const app = createOpenDropApp({
      repo: new TrustedHeaderTestRepo().asRepository(),
      storage: noopStorage,
      browserAuth: noopBrowserAuth,
      authConfig: trustedConfig({
        GITHUB_CLIENT_ID: "github-client",
        GITHUB_CLIENT_SECRET: "github-secret",
        GOOGLE_CLIENT_ID: "google-client",
        GOOGLE_CLIENT_SECRET: "google-secret"
      })
    });

    const response = await app.fetch(new Request("https://drop.example.test/api/session"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      authenticated: false,
      oauthProviders: ["github", "google"]
    });
  });

  it("keys OAuth users by provider account id instead of Better Auth user id", async () => {
    const repo = new TrustedHeaderTestRepo();
    const app = createOpenDropApp({
      repo: repo.asRepository(),
      storage: noopStorage,
      browserAuth: oauthBrowserAuth,
      authConfig: loadAuthConfig({
        OPENDROP_AUTH_MODE: "oauth",
        GITHUB_CLIENT_ID: "github-client",
        GITHUB_CLIENT_SECRET: "github-secret"
      })
    });

    const response = await app.fetch(new Request("https://drop.example.test/api/session"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      authenticated: true,
      authMode: "oauth",
      user: { email: "oauth@example.com" }
    });
    expect(repo.createdIdentities).toHaveLength(1);
    expect(repo.createdIdentities[0]).toMatchObject({
      provider: "oauth",
      subject: "github:gh_123",
      email: "oauth@example.com"
    });
    expect(repo.createdIdentities[0].subject).not.toBe("ba_user_1");
  });

  it("rejects OAuth sessions whose email has not been verified", async () => {
    const repo = new TrustedHeaderTestRepo();
    const app = createOpenDropApp({
      repo: repo.asRepository(),
      storage: noopStorage,
      browserAuth: oauthBrowserAuthWith({ emailVerified: false }),
      authConfig: oauthConfig()
    });

    expect(await (await app.fetch(new Request("https://drop.example.test/api/session"))).json()).toMatchObject({ authenticated: false });
    expect(repo.createdUsers).toHaveLength(0);
  });

  it("rejects sessions without an account from a configured OAuth provider", async () => {
    const repo = new TrustedHeaderTestRepo();
    const app = createOpenDropApp({
      repo: repo.asRepository(),
      storage: noopStorage,
      browserAuth: oauthBrowserAuthWith({}, "google"),
      authConfig: oauthConfig()
    });

    expect(await (await app.fetch(new Request("https://drop.example.test/api/session"))).json()).toMatchObject({ authenticated: false });
    expect(repo.createdUsers).toHaveLength(0);
  });
});

function oauthConfig() {
  return loadAuthConfig({
    OPENDROP_AUTH_MODE: "oauth",
    GITHUB_CLIENT_ID: "github-client",
    GITHUB_CLIENT_SECRET: "github-secret"
  });
}

function trustedConfig(overrides: Record<string, string> = {}) {
  return loadAuthConfig({
    OPENDROP_AUTH_MODE: "trusted-header",
    TRUSTED_PROXY_CIDRS: "127.0.0.1/32",
    TRUSTED_HEADER_EMAIL: "x-email",
    TRUSTED_HEADER_NAME: "x-name",
    ...overrides
  });
}

class TrustedHeaderTestRepo {
  readonly createdUsers: UserRecord[] = [];
  readonly createdIdentities: IdentityInput[] = [];
  private readonly identities = new Map<string, UserRecord>();

  asRepository(): OpenDropRepository {
    return {
      getUserByCliTokenHash: async () => null,
      getUserByIdentity: async (provider, subject) => this.identities.get(`${provider}:${subject}`) ?? null,
      linkIdentityToEmail: async () => null,
      getOrCreateUser: async (identity) => this.getOrCreateUser(identity)
    } as unknown as OpenDropRepository;
  }

  private getOrCreateUser(identity: IdentityInput): UserRecord {
    const key = `${identity.provider}:${identity.subject}`;
    const existing = this.identities.get(key);
    if (existing) return existing;
    this.createdIdentities.push(identity);
    const now = new Date(0).toISOString();
    const user: UserRecord = {
      id: `usr_${this.createdUsers.length + 1}`,
      email: identity.email,
      name: identity.name ?? null,
      avatarUrl: identity.avatarUrl ?? null,
      defaultNamespace: namespaceCandidateForEmail(identity.email),
      createdAt: now,
      updatedAt: now
    };
    this.createdUsers.push(user);
    this.identities.set(key, user);
    return user;
  }
}

const noopStorage: ArtifactStorage = {
  putObject: async () => undefined,
  getObject: async () => null,
  deletePrefix: async () => undefined
};

const noopBrowserAuth: BrowserAuth = {
  handler: () => new Response("not found", { status: 404 }),
  api: {
    getSession: async () => null
  }
};

const oauthBrowserAuth: BrowserAuth = {
  handler: () => new Response("not found", { status: 404 }),
  api: {
    getSession: async () => ({
      user: {
        id: "ba_user_1",
        email: "OAuth@Example.com",
        emailVerified: true,
        name: "OAuth User",
        image: "https://example.com/avatar.png"
      }
    })
  },
  resolveOAuthAccount: async () => ({
    providerId: "github",
    accountId: "gh_123"
  })
};

function oauthBrowserAuthWith(user: Partial<{ emailVerified: boolean }> = {}, providerId: "github" | "google" = "github"): BrowserAuth {
  return {
    ...oauthBrowserAuth,
    api: {
      getSession: async () => ({
        user: {
          id: "ba_user_1",
          email: "OAuth@Example.com",
          emailVerified: user.emailVerified ?? true,
          name: "OAuth User",
          image: null
        }
      })
    },
    resolveOAuthAccount: async (_betterAuthUserId, providers) =>
      providers.includes(providerId) ? { providerId, accountId: "account_123" } : null
  };
}
