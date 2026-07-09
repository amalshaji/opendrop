import { describe, expect, it } from "vitest";
import { createOpenDropApp } from "../../apps/server/src/app";
import { loadAuthConfig } from "@opendrop/shared/auth";
import type { OpenDropRepository } from "@opendrop/shared/db/repository";
import type { AnnotationRecord, DeploymentWithVersion, UserRecord } from "@opendrop/shared/db/types";
import type { ArtifactStorage } from "@opendrop/shared/storage/interface";
import type { BrowserAuth } from "../../apps/server/src/auth";

describe("annotation HTTP responses", () => {
  it("includes reviewer identity with annotations", async () => {
    const repo = new AnnotationResponseRepo();
    const app = createOpenDropApp({
      repo: repo.asRepository(),
      storage: noopStorage,
      browserAuth: noopBrowserAuth,
      authConfig: loadAuthConfig({ OPENDROP_AUTH_MODE: "dev" })
    });

    const response = await app.fetch(
      new Request("https://drop.example.test/api/deployments/team/demo/annotations?path=/&versionId=ver_1")
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      annotations: [
        { body: "Owner note", author: { email: "owner@example.com", name: "Owner User" } },
        { body: "Reviewer note", author: { email: "reviewer@example.com", name: "Reviewer User" } }
      ]
    });
  });
});

class AnnotationResponseRepo {
  private readonly users = new Map<string, UserRecord>([
    ["usr_owner", user("usr_owner", "owner@example.com", "Owner User")],
    ["usr_reviewer", user("usr_reviewer", "reviewer@example.com", "Reviewer User")]
  ]);

  asRepository(): OpenDropRepository {
    return {
      getUserById: async (id) => this.users.get(id) ?? null,
      getUserByCliTokenHash: async () => null,
      getDeploymentVersion: async () => deployment,
      listAnnotations: async () => annotations
    } as unknown as OpenDropRepository;
  }
}

const deployment: DeploymentWithVersion = {
  family: {
    id: "fam_1",
    namespaceId: "nsp_1",
    namespaceName: "team",
    slug: "demo",
    ownerUserId: "usr_owner",
    latestVersionId: "ver_1",
    visibility: "public",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  },
  version: {
    id: "ver_1",
    familyId: "fam_1",
    versionNumber: 1,
    createdByUserId: "usr_owner",
    manifestHash: "hash",
    fileCount: 1,
    totalBytes: 1,
    createdAt: "2026-01-01T00:00:00.000Z"
  }
};

const annotations: AnnotationRecord[] = [
  annotation("ann_owner", "usr_owner", "Owner note"),
  annotation("ann_reviewer", "usr_reviewer", "Reviewer note")
];

function annotation(id: string, authorUserId: string, body: string): AnnotationRecord {
  return {
    id,
    familyId: "fam_1",
    versionId: "ver_1",
    parentAnnotationId: null,
    pagePath: "/",
    authorUserId,
    body,
    tags: [],
    shape: { type: "pin", x: 0.5, y: 0.5 },
    viewport: { width: 1200, height: 800, scrollX: 0, scrollY: 0 },
    resolvedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function user(id: string, email: string, name: string): UserRecord {
  return {
    id,
    email,
    name,
    avatarUrl: null,
    defaultNamespace: email.split("@")[0],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
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
