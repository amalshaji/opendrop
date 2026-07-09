import { describe, expect, it } from "vitest";
import { createOpenDropApp, registerDeploymentPageRoutes } from "../../apps/server/src/app";
import { loadAuthConfig } from "@opendrop/shared/auth";
import type { CreateVersionInput, OpenDropRepository } from "@opendrop/shared/db/repository";
import type { DeploymentFileRecord, DeploymentWithVersion, IdentityInput, UserRecord } from "@opendrop/shared/db/types";
import type { ArtifactObject, ArtifactStorage } from "@opendrop/shared/storage/interface";
import type { BrowserAuth } from "../../apps/server/src/auth";

describe("upload publishing", () => {
  it("does not create a deployment version when storage fails", async () => {
    const repo = new UploadTestRepo();
    const storage = new MemoryArtifactStorage("write-then-throw");
    const app = testApp(repo, storage);

    const response = await app.fetch(publishRequest());

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "Artifact storage write failed." });
    expect(repo.createdVersions).toHaveLength(0);
    expect(storage.objects.size).toBe(0);
    expect(storage.deletedPrefixes).toHaveLength(1);
  });

  it("cleans uploaded objects when repository creation fails after storage succeeds", async () => {
    const repo = new UploadTestRepo({ failCreateVersion: true });
    const storage = new MemoryArtifactStorage();
    const app = testApp(repo, storage);

    const response = await app.fetch(publishRequest());

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "create failed" });
    expect(storage.objects.size).toBe(0);
    expect(storage.deletedPrefixes).toHaveLength(1);
  });

  it("serves uploaded HTML with a sandbox CSP", async () => {
    const repo = new UploadTestRepo();
    const storage = new MemoryArtifactStorage();
    const app = testApp(repo, storage);
    registerDeploymentPageRoutes(app, {
      repo: repo.asRepository(),
      storage,
      authConfig: authConfig
    });

    const publishResponse = await app.fetch(publishRequest());
    expect(publishResponse.status).toBe(200);

    const response = await app.fetch(new Request("https://drop.example.test/team/demo/"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toBe("sandbox allow-scripts allow-forms allow-popups");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toContain("<h1>Home</h1>");
  });
});

const authConfig = loadAuthConfig({ OPENDROP_AUTH_MODE: "dev" });

function testApp(repo: UploadTestRepo, storage: ArtifactStorage) {
  return createOpenDropApp({
    repo: repo.asRepository(),
    storage,
    browserAuth: noopBrowserAuth,
    authConfig,
    trustedSourceIp: "127.0.0.1"
  });
}

function publishRequest(): Request {
  const form = new FormData();
  form.set("namespace", "team");
  form.set("slug", "demo");
  form.set("visibility", "public");
  form.append("files", new Blob(["<h1>Home</h1>"], { type: "text/html" }), "index.html");
  return new Request("https://drop.example.test/api/uploads/publish", {
    method: "POST",
    headers: { "x-opendrop-email": "dev@example.com" },
    body: form
  });
}

class UploadTestRepo {
  readonly createdVersions: CreateVersionInput[] = [];
  private readonly identities = new Map<string, UserRecord>();
  private readonly files = new Map<string, DeploymentFileRecord>();
  private deployment: DeploymentWithVersion | null = null;

  constructor(private readonly options: { failCreateVersion?: boolean } = {}) {}

  asRepository(): OpenDropRepository {
    return {
      getUserByCliTokenHash: async () => null,
      getUserByIdentity: async (provider, subject) => this.identities.get(`${provider}:${subject}`) ?? null,
      linkIdentityToEmail: async () => null,
      getOrCreateUser: async (identity) => this.getOrCreateUser(identity),
      userCanPublishNamespace: async () => true,
      createDeploymentVersion: async (input) => this.createDeploymentVersion(input),
      getDeploymentVersion: async () => this.deployment,
      getDeploymentFile: async (versionId, path) => this.files.get(`${versionId}:${path}`) ?? null
    } as unknown as OpenDropRepository;
  }

  private getOrCreateUser(identity: IdentityInput): UserRecord {
    const key = `${identity.provider}:${identity.subject}`;
    const existing = this.identities.get(key);
    if (existing) return existing;
    const now = new Date(0).toISOString();
    const user: UserRecord = {
      id: "usr_1",
      email: identity.email,
      name: identity.name ?? null,
      avatarUrl: identity.avatarUrl ?? null,
      defaultNamespace: "team",
      createdAt: now,
      updatedAt: now
    };
    this.identities.set(key, user);
    return user;
  }

  private createDeploymentVersion(input: CreateVersionInput): DeploymentWithVersion {
    if (this.options.failCreateVersion) throw new Error("create failed");
    this.createdVersions.push(input);
    const now = new Date(0).toISOString();
    this.deployment = {
      family: {
        id: "fam_1",
        namespaceId: "ns_1",
        namespaceName: input.namespace,
        slug: input.slug,
        ownerUserId: input.ownerUserId,
        latestVersionId: input.versionId ?? "ver_1",
        visibility: input.visibility,
        createdAt: now,
        updatedAt: now
      },
      version: {
        id: input.versionId ?? "ver_1",
        familyId: "fam_1",
        versionNumber: 1,
        createdByUserId: input.ownerUserId,
        manifestHash: input.manifestHash,
        fileCount: input.files.length,
        totalBytes: input.files.reduce((total, file) => total + file.size, 0),
        createdAt: now
      }
    };
    for (const [index, file] of input.files.entries()) {
      this.files.set(`${this.deployment.version.id}:${file.path}`, {
        id: `file_${index + 1}`,
        versionId: this.deployment.version.id,
        ...file
      });
    }
    return this.deployment;
  }
}

class MemoryArtifactStorage implements ArtifactStorage {
  readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();
  readonly deletedPrefixes: string[] = [];

  constructor(private readonly mode: "normal" | "write-then-throw" = "normal") {}

  async putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType });
    if (this.mode === "write-then-throw") throw new Error("put failed");
  }

  async getObject(key: string): Promise<ArtifactObject | null> {
    const object = this.objects.get(key);
    return object ? { body: object.body, contentType: object.contentType, size: object.body.byteLength } : null;
  }

  async deletePrefix(prefix: string): Promise<void> {
    this.deletedPrefixes.push(prefix);
    for (const key of this.objects.keys()) {
      if (key.startsWith(prefix)) this.objects.delete(key);
    }
  }
}

const noopBrowserAuth: BrowserAuth = {
  handler: () => new Response("not found", { status: 404 }),
  api: {
    getSession: async () => null
  }
};
