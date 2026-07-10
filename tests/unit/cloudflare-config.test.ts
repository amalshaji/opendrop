import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Cloudflare direct-upload limits", () => {
  it("configures enough paid-plan subrequests for the 20,000-file finalization path", () => {
    const wrangler = readFileSync("apps/server/wrangler.toml", "utf8");
    const configured = wrangler.match(/\[limits\][\s\S]*?subrequests\s*=\s*(\d+)/)?.[1];
    expect(Number(configured)).toBeGreaterThanOrEqual(25_000);

    const docs = readFileSync("docs/05-cloudflare.md", "utf8");
    expect(docs).toContain("Workers Paid");
    expect(docs).toContain("1,000 internal-service subrequests");
    expect(docs).toContain("20,000-file maximum");
  });
});
