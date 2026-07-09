import { describe, expect, it } from "vitest";
import { loadAuthConfig, readTrustedHeaderIdentity } from "@opendrop/shared/auth";

describe("trusted header auth", () => {
  it("reads identity from a trusted source", () => {
    const config = loadAuthConfig({
      OPENDROP_AUTH_MODE: "trusted-header",
      TRUSTED_PROXY_CIDRS: "10.0.0.0/8",
      TRUSTED_HEADER_EMAIL: "x-email"
    });
    const headers = new Headers({ "x-email": "User@example.com" });
    const result = readTrustedHeaderIdentity(headers, "10.1.2.3", config);
    expect(result.identity?.email).toBe("user@example.com");
  });

  it("rejects spoofed headers from untrusted sources", () => {
    const config = loadAuthConfig({
      OPENDROP_AUTH_MODE: "trusted-header",
      TRUSTED_PROXY_CIDRS: "10.0.0.0/8",
      TRUSTED_HEADER_EMAIL: "x-email"
    });
    const headers = new Headers({ "x-email": "user@example.com" });
    const result = readTrustedHeaderIdentity(headers, "192.168.1.10", config);
    expect(result.identity).toBeNull();
    expect(result.error).toMatch(/untrusted/);
  });

  it("reads identity from a configured trusted runtime host", () => {
    const config = loadAuthConfig({
      OPENDROP_AUTH_MODE: "trusted-header",
      TRUSTED_PROXY_CIDRS: "10.0.0.0/8",
      TRUSTED_PROXY_HOSTS: "cloudflare-workers",
      TRUSTED_HEADER_EMAIL: "x-email"
    });
    const headers = new Headers({ "x-email": "User@example.com" });
    const result = readTrustedHeaderIdentity(headers, { ip: null, host: "cloudflare-workers" }, config);
    expect(result.identity?.email).toBe("user@example.com");
  });

  it("applies domain restrictions before provisioning", () => {
    const config = loadAuthConfig({
      OPENDROP_AUTH_MODE: "trusted-header",
      OPENDROP_ALLOWED_EMAIL_DOMAINS: "example.com",
      TRUSTED_PROXY_CIDRS: "127.0.0.1/32",
      TRUSTED_HEADER_EMAIL: "x-email"
    });
    const headers = new Headers({ "x-email": "user@other.com" });
    const result = readTrustedHeaderIdentity(headers, "127.0.0.1", config);
    expect(result.identity).toBeNull();
    expect(result.error).toMatch(/domain/);
  });

  it("validates auth env values with zod", () => {
    expect(() =>
      loadAuthConfig({
        OPENDROP_AUTH_MODE: "trusted-header",
        OPENDROP_DEFAULT_VISIBILITY: "team-only"
      })
    ).toThrow();
  });
});
