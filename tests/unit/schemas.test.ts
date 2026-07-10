import { describe, expect, it } from "vitest";
import {
  annotationInputSchema,
  annotationPageNoteInputSchema,
  annotationReplyInputSchema,
  annotationResolveInputSchema,
  artifactRoutePathSchema,
  deviceCodeResponseSchema,
  deploymentRefInputSchema,
  deploymentTargetSchema,
  deploymentRefSchema,
  devLoginBodySchema,
  fetchIncludeSchema,
  pagePathSchema,
  pageQuerySchema,
  publishedDeploymentsResponseSchema,
  previewRoutePathSchema,
  safeReturnQuerySchema,
  uploadMetadataSchema,
  versionedDeploymentRefSchema
} from "@opendrop/shared/core";

describe("zod request schemas", () => {
  it("normalizes upload namespace and slug metadata", () => {
    const parsed = uploadMetadataSchema.parse({
      namespace: "Amal Shaji",
      slug: "Marketing Preview",
      visibility: "private"
    });

    expect(parsed).toEqual({
      namespace: "amal-shaji",
      slug: "marketing-preview",
      visibility: "private"
    });
  });

  it("rejects invalid deployment route params", () => {
    expect(deploymentRefSchema.safeParse({ namespace: "api", slug: "demo" }).success).toBe(false);
    expect(deploymentRefSchema.safeParse({ namespace: "amal", slug: "settings" }).success).toBe(false);
  });

  it("parses fixed version refs", () => {
    expect(versionedDeploymentRefSchema.parse({ namespace: "amal", slug: "demo", versionId: "ver_123" })).toEqual({
      namespace: "amal",
      slug: "demo",
      versionId: "ver_123"
    });
  });

  it("validates and narrows published deployment responses", () => {
    const parsed = publishedDeploymentsResponseSchema.parse({
      deployments: [
        {
          family: {
            id: "dep_123",
            namespaceName: "amal",
            slug: "demo",
            visibility: "public",
            updatedAt: "2026-07-10T00:00:00.000Z",
            ownerUserId: "internal-user-id"
          },
          version: {
            id: "ver_123",
            versionNumber: 2,
            fileCount: 4,
            totalBytes: 1024,
            manifestHash: "internal-manifest-hash"
          }
        }
      ]
    });

    expect(parsed.deployments[0]).toEqual({
      family: {
        id: "dep_123",
        namespaceName: "amal",
        slug: "demo",
        visibility: "public",
        updatedAt: "2026-07-10T00:00:00.000Z"
      },
      version: {
        id: "ver_123",
        versionNumber: 2,
        fileCount: 4,
        totalBytes: 1024
      }
    });
    expect(publishedDeploymentsResponseSchema.safeParse({ deployments: [{ family: {}, version: {} }] }).success).toBe(false);
  });

  it("parses URL and string deployment references through shared schemas", () => {
    expect(deploymentRefInputSchema.parse("/amal/demo")).toEqual({ namespace: "amal", slug: "demo" });
    expect(deploymentTargetSchema.parse("https://drop.test/amal/demo/versions/ver_123")).toEqual({
      namespace: "amal",
      slug: "demo",
      versionId: "ver_123"
    });
    expect(deploymentTargetSchema.parse("https://drop.test/preview/amal/demo/latest/index.html")).toEqual({
      namespace: "amal",
      slug: "demo",
      versionId: "latest"
    });
    expect(deploymentTargetSchema.parse("https://drop.test/amal/demo?version=ver_123")).toEqual({
      namespace: "amal",
      slug: "demo",
      versionId: "ver_123"
    });
  });

  it("parses preview shell route paths through a shared schema", () => {
    expect(previewRoutePathSchema.parse("/amal/demo")).toEqual({ namespace: "amal", slug: "demo" });
    expect(previewRoutePathSchema.parse("/amal/demo/versions/ver_123")).toEqual({
      namespace: "amal",
      slug: "demo",
      versionId: "ver_123"
    });
    expect(previewRoutePathSchema.safeParse("/amal/demo/assets/app.css").success).toBe(false);
  });

  it("parses annotation replies and resolve payloads", () => {
    expect(
      annotationInputSchema.parse({
        versionId: "ver_123",
        parentAnnotationId: "ann_123",
        body: "Reply",
        tags: ["review"],
        shape: { type: "pin", x: 0.5, y: 0.5 },
        viewport: { width: 1280, height: 720 }
      })
    ).toMatchObject({ parentAnnotationId: "ann_123", pagePath: "/" });
    expect(annotationResolveInputSchema.parse({ resolved: true })).toEqual({ resolved: true });
    expect(annotationPageNoteInputSchema.parse({ body: "Page note" })).toEqual({
      body: "Page note",
      pagePath: "/",
      tags: []
    });
    expect(annotationReplyInputSchema.parse({ body: "Reply" })).toEqual({ body: "Reply", tags: [] });
    expect(annotationInputSchema.parse({ body: "Page note", shape: { type: "page" }, viewport: null })).toMatchObject({
      shape: { type: "page" },
      viewport: null
    });
  });

  it("rejects unsafe page and artifact paths", () => {
    expect(pagePathSchema.safeParse("/nested/page.html").success).toBe(true);
    expect(pagePathSchema.safeParse("../secret.html").success).toBe(false);
    expect(artifactRoutePathSchema.safeParse("assets/app.css").success).toBe(true);
    expect(artifactRoutePathSchema.safeParse("../secret.txt").success).toBe(false);
  });

  it("normalizes query-style Zod parsing for CLI and server requests", () => {
    expect(pageQuerySchema.parse({ path: "", versionId: "" })).toEqual({ path: "/", versionId: undefined });
    expect(fetchIncludeSchema.parse("html, annotations")).toEqual(["html", "annotations"]);
    expect(fetchIncludeSchema.safeParse("html,unknown").success).toBe(false);
    expect(safeReturnQuerySchema.parse({ returnTo: "https://evil.test", name: "" })).toEqual({
      returnTo: undefined,
      name: undefined,
      json: undefined
    });
  });

  it("rejects annotation coordinates outside normalized bounds", () => {
    expect(
      annotationInputSchema.safeParse({
        body: "Outside",
        shape: { type: "pin", x: 1.2, y: 0.5 },
        viewport: { width: 1280, height: 720 }
      }).success
    ).toBe(false);
  });

  it("bounds annotation text, tags, and freehand payloads", () => {
    const base = {
      body: "A bounded note",
      shape: { type: "freehand" as const, points: [{ x: 0.5, y: 0.5 }] },
      viewport: { width: 1280, height: 720 }
    };

    expect(annotationInputSchema.safeParse({ ...base, body: "x".repeat(10_001) }).success).toBe(false);
    expect(annotationInputSchema.safeParse({ ...base, tags: Array.from({ length: 21 }, (_, index) => `tag-${index}`) }).success).toBe(false);
    expect(annotationInputSchema.safeParse({ ...base, tags: ["x".repeat(65)] }).success).toBe(false);
    expect(
      annotationInputSchema.safeParse({
        ...base,
        shape: { type: "freehand", points: Array.from({ length: 401 }, () => ({ x: 0.5, y: 0.5 })) }
      }).success
    ).toBe(false);
  });

  it("applies server route body defaults through shared schemas", () => {
    expect(devLoginBodySchema.parse({})).toEqual({
      email: "dev@example.com",
      name: "Dev User"
    });
  });

  it("parses CLI device flow responses before use", () => {
    expect(
      deviceCodeResponseSchema.parse({
        deviceCode: "device",
        userCode: "ABCD-EFGH",
        verificationUri: "https://drop.example.test/device",
        verificationUriComplete: "https://drop.example.test/device?user_code=ABCD-EFGH",
        expiresAt: "2026-01-01T00:00:00.000Z",
        interval: "2"
      }).interval
    ).toBe(2);
  });
});
