import { describe, expect, it } from "vitest";
import { createBrowserAuth, requiredBetterAuthSecret, resolveOAuthAccount } from "../../apps/server/src/auth";

describe("browser auth configuration", () => {
  it("requires an explicit strong Better Auth secret for OAuth", () => {
    expect(() => requiredBetterAuthSecret(undefined)).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => requiredBetterAuthSecret("too-short")).toThrow(/at least 32/);
    expect(requiredBetterAuthSecret("a".repeat(32))).toBe("a".repeat(32));
    expect(() => createBrowserAuth({ OPENDROP_AUTH_MODE: "oauth" }, null)).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("resolves linked accounts in configured provider order", async () => {
    const requestedProviders: string[] = [];
    const database = {
      prepare: () => ({
        get: (_userId: string, providerId: string) => {
          requestedProviders.push(providerId);
          return providerId === "google" ? { providerId, accountId: "google_123" } : null;
        }
      })
    };

    await expect(resolveOAuthAccount(database, "user_123", ["github", "google"])).resolves.toEqual({
      providerId: "google",
      accountId: "google_123"
    });
    expect(requestedProviders).toEqual(["github", "google"]);
  });
});
