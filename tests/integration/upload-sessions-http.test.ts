import { beforeEach, describe, expect, it } from "vitest";
import { createOpenDropApp } from "../../apps/server/src/app";
import { loadAuthConfig } from "@opendrop/shared/auth";
import {
  DIRECT_UPLOAD_MANIFEST_MAX_BYTES,
  manifestHash,
  serializedUploadManifestBytes,
  sha256Hex,
  storageKey,
  type FileManifestEntry
} from "@opendrop/shared/core";
import type {
  CompleteUploadSessionInput,
  CreateUploadSessionInput,
  CreateVersionInput,
  FailUploadSessionInput,
  FailUploadSessionResult,
  FinalizeUploadSessionClaim,
  OpenDropRepository
} from "@opendrop/shared/db/repository";
import type { DeploymentWithVersion, IdentityInput, UploadSessionRecord, UserRecord } from "@opendrop/shared/db/types";
import type { ArtifactObject, ArtifactStorage, DirectUploadCapability, DirectUploadRequest, PresignedUploadTarget } from "@opendrop/shared/storage/interface";
import type { BrowserAuth } from "../../apps/server/src/auth";

describe("direct upload sessions", () => {
  let repo: SessionTestRepo;
  let storage: MemoryDirectStorage;
  let app: ReturnType<typeof createOpenDropApp>;

  beforeEach(async () => {
    repo = new SessionTestRepo();
    storage = new MemoryDirectStorage();
    app = testApp(repo, storage);
  });

  it("requires authentication and namespace publish access", async () => {
    const unauthorized = await app.fetch(sessionRequest(undefined));
    expect(unauthorized.status).toBe(401);

    await app.fetch(sessionRequest("other@example.com"));
    const denied = await app.fetch(sessionRequest("owner@example.com", { namespace: "other" }));
    expect(denied.status).toBe(403);
  });

  it("rejects foreign sessions, unknown paths, and URL batches over 100", async () => {
    const created = await createSession(app, "owner@example.com", manyManifest(101));
    const foreign = await app.fetch(urlRequest(created.sessionId, ["index.html"], "other@example.com"));
    expect(foreign.status).toBe(404);

    const unknown = await app.fetch(urlRequest(created.sessionId, ["missing.html"], "owner@example.com"));
    expect(unknown.status).toBe(400);

    const tooMany = await app.fetch(urlRequest(created.sessionId, manyManifest(101).map((entry) => entry.path), "owner@example.com"));
    expect(tooMany.status).toBe(400);
  });

  it("verifies uploaded bytes and finalizes idempotently without a second version", async () => {
    const created = await createSession(app, "owner@example.com", [indexEntry]);
    const urls = await app.fetch(urlRequest(created.sessionId, ["index.html"], "owner@example.com"));
    expect(urls.status).toBe(200);
    const target = ((await urls.json()) as { uploads: Array<PresignedUploadTarget & { path: string }> }).uploads[0]!;
    expect(target.headers["x-amz-meta-sha256"]).toBe(indexEntry.sha256);
    await storage.upload(target.url, indexBytes, target.headers);

    const barrier = storage.blockNextRead();
    const firstFinalize = app.fetch(finalizeRequest(created.sessionId, "owner@example.com"));
    await barrier.started;
    const concurrent = await app.fetch(finalizeRequest(created.sessionId, "owner@example.com"));
    expect(concurrent.status).toBe(409);
    expect(await concurrent.json()).toMatchObject({ code: "upload_session_finalizing" });
    expect(storage.deletedPrefixes).toHaveLength(0);
    barrier.release();
    const first = await firstFinalize;
    expect(first.status).toBe(200);
    expect((await first.json() as { version: { id: string } }).version.id).toBe(created.versionId);

    const repeated = await app.fetch(finalizeRequest(created.sessionId, "owner@example.com"));
    expect(repeated.status).toBe(200);
    expect((await repeated.json() as { version: { id: string } }).version.id).toBe(created.versionId);
    expect((await repo.asRepository().listDeploymentVersions(created.namespace, created.slug))).toHaveLength(1);
    expect(storage.getObjectCalls).toBe(1);
    expect(storage.deletedPrefixes).toHaveLength(0);
  });

  it("renews the finalization lease before the original upload expiry can race cleanup", async () => {
    await app.fetch(sessionRequest("owner@example.com"));
    const repository = repo.asRepository();
    const user = await repository.getUserByIdentity("dev", "owner@example.com");
    const originalExpiresAt = new Date(Date.now() + 500).toISOString();
    const hash = await manifestHash([indexEntry]);
    await repository.createUploadSession({
      id: "upl_near_expiry",
      ownerUserId: user!.id,
      namespace: user!.defaultNamespace,
      slug: "near-expiry",
      visibility: "public",
      versionId: "ver_near_expiry",
      manifestHash: hash,
      manifest: [indexEntry],
      expiresAt: originalExpiresAt
    });
    await storage.putObject(
      storageKey(user!.defaultNamespace, "near-expiry", "ver_near_expiry", "index.html"),
      indexBytes,
      indexEntry.contentType
    );

    const barrier = storage.blockNextRead();
    const claimant = app.fetch(finalizeRequest("upl_near_expiry", "owner@example.com"));
    await barrier.started;
    const claimedSession = await repository.getUploadSessionForOwner("upl_near_expiry", user!.id);
    expect(claimedSession?.status).toBe("finalizing");
    expect(Date.parse(claimedSession!.expiresAt)).toBeGreaterThan(Date.parse(originalExpiresAt));
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, Date.parse(originalExpiresAt) - Date.now() + 25)));

    const concurrent = await app.fetch(finalizeRequest("upl_near_expiry", "owner@example.com"));
    expect(concurrent.status).toBe(409);
    expect(await concurrent.json()).toMatchObject({ code: "upload_session_finalizing" });
    expect(storage.deletedPrefixes).toHaveLength(0);
    barrier.release();
    expect((await claimant).status).toBe(200);
    expect((await repository.listDeploymentVersions(user!.defaultNamespace, "near-expiry"))).toHaveLength(1);
    expect((await app.fetch(finalizeRequest("upl_near_expiry", "owner@example.com"))).status).toBe(200);
    expect(storage.getObjectCalls).toBe(1);
    expect(storage.deletedPrefixes).toHaveLength(0);
  });

  it("rejects a truthful hash and size when the declared text line count is false", async () => {
    const created = await createSession(app, "owner@example.com", [{ ...indexEntry, lineCount: 2 }]);
    const urls = await app.fetch(urlRequest(created.sessionId, ["index.html"], "owner@example.com"));
    const target = ((await urls.json()) as { uploads: Array<PresignedUploadTarget & { path: string }> }).uploads[0]!;
    await storage.upload(target.url, indexBytes, target.headers);

    const response = await app.fetch(finalizeRequest(created.sessionId, "owner@example.com"));
    expect(response.status).toBe(422);
    expect((await response.json() as { error: string }).error).toContain("line count does not match");
    expect((await repo.asRepository().listDeploymentVersions(created.namespace, created.slug))).toHaveLength(0);
  });

  it("returns an explicit pre-session fallback code for a D1-unsafe serialized manifest", async () => {
    const manifest = [indexEntry, ...Array.from({ length: 600 }, (_, index) => ({
      path: `assets/${index}-${"x".repeat(1_700)}.bin`,
      size: 0,
      sha256: "c".repeat(64),
      contentType: "application/octet-stream"
    }))];
    expect(serializedUploadManifestBytes(manifest)).toBeGreaterThan(DIRECT_UPLOAD_MANIFEST_MAX_BYTES);
    const response = await app.fetch(sessionRequest("owner@example.com", { manifest }));
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: "direct_upload_manifest_too_large" });
    expect(repo.sessionCount).toBe(0);
  });

  it("deletes staged objects and marks the session failed when content is tampered", async () => {
    const created = await createSession(app, "owner@example.com", [indexEntry]);
    const urls = await app.fetch(urlRequest(created.sessionId, ["index.html"], "owner@example.com"));
    const target = ((await urls.json()) as { uploads: Array<PresignedUploadTarget & { path: string }> }).uploads[0]!;
    await storage.upload(target.url, new TextEncoder().encode("<h1>Hack</h1>"), target.headers);

    const response = await app.fetch(finalizeRequest(created.sessionId, "owner@example.com"));
    expect(response.status).toBe(422);
    expect((await response.json() as { error: string }).error).toContain("checksum does not match");
    expect(storage.objects.size).toBe(0);
    const user = await repo.asRepository().getUserByIdentity("dev", "owner@example.com");
    expect((await repo.asRepository().getUploadSessionForOwner(created.sessionId, user!.id))?.status).toBe("failed");
    expect((await repo.asRepository().listDeploymentVersions(created.namespace, created.slug))).toHaveLength(0);
  });

  it("keeps legacy multipart publishing available when direct signing is disabled", async () => {
    const legacyStorage = new MemoryDirectStorage(false);
    const legacyApp = testApp(repo, legacyStorage);
    const unavailable = await legacyApp.fetch(sessionRequest("owner@example.com"));
    expect(unavailable.status).toBe(501);
    expect(await unavailable.json()).toMatchObject({ code: "direct_upload_unavailable" });

    const form = new FormData();
    form.set("slug", "legacy");
    form.append("files", new Blob([indexBytes], { type: "text/html" }), "index.html");
    const response = await legacyApp.fetch(new Request("https://drop.example.test/api/uploads/publish", {
      method: "POST",
      headers: authHeaders("owner@example.com"),
      body: form
    }));
    expect(response.status).toBe(200);
  });

  it("expires durable sessions before issuing URLs and records the terminal failure", async () => {
    await app.fetch(sessionRequest("owner@example.com"));
    const repository = repo.asRepository();
    const user = await repository.getUserByIdentity("dev", "owner@example.com");
    await repository.createUploadSession({
      id: "upl_expired",
      ownerUserId: user!.id,
      namespace: user!.defaultNamespace,
      slug: "expired",
      visibility: "public",
      versionId: "ver_expired",
      manifestHash: "expired-manifest",
      manifest: [indexEntry],
      expiresAt: new Date(Date.now() - 1_000).toISOString()
    });

    const response = await app.fetch(urlRequest("upl_expired", ["index.html"], "owner@example.com"));
    expect(response.status).toBe(410);
    expect((await repository.getUploadSessionForOwner("upl_expired", user!.id))?.status).toBe("failed");
  });

  it("fails and cleans an expired finalization lease", async () => {
    await app.fetch(sessionRequest("owner@example.com"));
    const repository = repo.asRepository();
    const user = await repository.getUserByIdentity("dev", "owner@example.com");
    const hash = await manifestHash([indexEntry]);
    await repository.createUploadSession({
      id: "upl_crashed_failed",
      ownerUserId: user!.id,
      namespace: user!.defaultNamespace,
      slug: "crashed-failed",
      visibility: "public",
      versionId: "ver_crashed_failed",
      manifestHash: hash,
      manifest: [indexEntry],
      expiresAt: new Date(Date.now() - 1_000).toISOString()
    });
    repo.forceFinalizing("upl_crashed_failed");
    await storage.putObject(
      storageKey(user!.defaultNamespace, "crashed-failed", "ver_crashed_failed", "index.html"),
      indexBytes,
      indexEntry.contentType
    );
    const failed = await app.fetch(finalizeRequest("upl_crashed_failed", "owner@example.com"));
    expect(failed.status).toBe(410);
    expect((await repository.getUploadSessionForOwner("upl_crashed_failed", user!.id))?.status).toBe("failed");
    expect(storage.objects.size).toBe(0);
  });
});

const indexBytes = new TextEncoder().encode("<h1>Home</h1>");
const indexEntry: FileManifestEntry = {
  path: "index.html",
  size: indexBytes.byteLength,
  sha256: await sha256Hex(indexBytes),
  contentType: "text/html; charset=utf-8",
  lineCount: 1
};

function manyManifest(count: number): FileManifestEntry[] {
  return Array.from({ length: count }, (_, index) => index === 0 ? indexEntry : ({
    path: `assets/file-${index}.txt`,
    size: 1,
    sha256: "a".repeat(64),
    contentType: "text/plain; charset=utf-8",
    lineCount: 1
  }));
}

async function createSession(
  app: ReturnType<typeof createOpenDropApp>,
  email: string,
  manifest: FileManifestEntry[]
): Promise<{ sessionId: string; versionId: string; namespace: string; slug: string }> {
  const response = await app.fetch(sessionRequest(email, { slug: `direct-${Date.now()}-${Math.random()}`, manifest }));
  expect(response.status).toBe(201);
  return response.json();
}

function sessionRequest(
  email?: string,
  overrides: Record<string, unknown> = {}
): Request {
  return new Request("https://drop.example.test/api/uploads/sessions", {
    method: "POST",
    headers: { "content-type": "application/json", ...(email ? authHeaders(email) : {}) },
    body: JSON.stringify({ manifest: [indexEntry], ...overrides })
  });
}

function urlRequest(sessionId: string, paths: string[], email: string): Request {
  return new Request(`https://drop.example.test/api/uploads/sessions/${sessionId}/urls`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(email) },
    body: JSON.stringify({ paths })
  });
}

function finalizeRequest(sessionId: string, email: string): Request {
  return new Request(`https://drop.example.test/api/uploads/sessions/${sessionId}/finalize`, {
    method: "POST",
    headers: authHeaders(email)
  });
}

function authHeaders(email: string) {
  return { "x-opendrop-email": email };
}

function testApp(repo: SessionTestRepo, storage: ArtifactStorage) {
  return createOpenDropApp({
    repo: repo.asRepository(),
    storage,
    browserAuth: noopBrowserAuth,
    authConfig: loadAuthConfig({ OPENDROP_AUTH_MODE: "dev" }),
    trustedSourceIp: "127.0.0.1"
  });
}

class SessionTestRepo {
  private readonly identities = new Map<string, UserRecord>();
  private readonly sessions = new Map<string, UploadSessionRecord>();
  private readonly deployments = new Map<string, DeploymentWithVersion>();

  get sessionCount(): number {
    return this.sessions.size;
  }

  asRepository(): OpenDropRepository {
    return {
      migrate: async () => undefined,
      getUserByCliTokenHash: async () => null,
      getUserByIdentity: async (provider, subject) => this.identities.get(`${provider}:${subject}`) ?? null,
      linkIdentityToEmail: async () => null,
      getOrCreateUser: async (identity) => this.getOrCreateUser(identity),
      userCanPublishNamespace: async (userId, namespace) => {
        const user = [...this.identities.values()].find((item) => item.id === userId);
        return user?.defaultNamespace === namespace;
      },
      createUploadSession: async (input) => this.createUploadSession(input),
      getUploadSessionForOwner: async (sessionId, ownerUserId) => {
        const session = this.sessions.get(sessionId);
        return session?.ownerUserId === ownerUserId ? session : null;
      },
      claimUploadSessionForFinalization: async (sessionId, ownerUserId, finalizationExpiresAt) =>
        this.claimUploadSessionForFinalization(sessionId, ownerUserId, finalizationExpiresAt),
      failUploadSession: async (input) => this.failUploadSession(input),
      completeUploadSession: async (input) => this.completeUploadSession(input),
      createDeploymentVersion: async (input) => this.createDeploymentVersion(input),
      getDeploymentVersion: async (namespace, slug, versionId) => {
        const deployment = this.deployments.get(`${namespace}/${slug}`) ?? null;
        return deployment && (!versionId || deployment.version.id === versionId) ? deployment : null;
      },
      listDeploymentVersions: async (namespace, slug) => {
        const deployment = this.deployments.get(`${namespace}/${slug}`);
        return deployment ? [deployment.version] : [];
      }
    } as unknown as OpenDropRepository;
  }

  forceFinalizing(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Upload session not found.");
    this.sessions.set(sessionId, { ...session, status: "finalizing" });
  }

  private getOrCreateUser(identity: IdentityInput): UserRecord {
    const key = `${identity.provider}:${identity.subject}`;
    const existing = this.identities.get(key);
    if (existing) return existing;
    const now = new Date(0).toISOString();
    const user: UserRecord = {
      id: `usr_${this.identities.size + 1}`,
      email: identity.email,
      name: identity.name ?? null,
      avatarUrl: identity.avatarUrl ?? null,
      defaultNamespace: identity.email.split("@")[0]!,
      createdAt: now,
      updatedAt: now
    };
    this.identities.set(key, user);
    return user;
  }

  private createUploadSession(input: CreateUploadSessionInput): UploadSessionRecord {
    const now = new Date().toISOString();
    const record: UploadSessionRecord = {
      ...input,
      status: "pending",
      failureReason: null,
      createdAt: now,
      updatedAt: now
    };
    this.sessions.set(record.id, record);
    return record;
  }

  private failUploadSession(input: FailUploadSessionInput): FailUploadSessionResult {
    const record = this.sessions.get(input.sessionId);
    if (!record || record.ownerUserId !== input.ownerUserId) throw new Error("Upload session not found.");
    if (record.status !== input.expectedStatus) return { failed: false, session: record };
    const next: UploadSessionRecord = {
      ...record,
      status: "failed",
      failureReason: input.reason,
      updatedAt: new Date().toISOString()
    };
    this.sessions.set(next.id, next);
    return { failed: true, session: next };
  }

  private completeUploadSession(input: CompleteUploadSessionInput): DeploymentWithVersion {
    const session = this.sessions.get(input.sessionId);
    if (!session || session.ownerUserId !== input.ownerUserId || session.status !== "finalizing") {
      throw new Error("Upload session is not claimed for finalization.");
    }
    const deployment = this.createDeploymentVersion(input.deployment);
    this.sessions.set(session.id, { ...session, status: "completed", failureReason: null, updatedAt: new Date().toISOString() });
    return deployment;
  }

  private claimUploadSessionForFinalization(
    sessionId: string,
    ownerUserId: string,
    finalizationExpiresAt: string
  ): FinalizeUploadSessionClaim | null {
    const record = this.sessions.get(sessionId);
    if (!record || record.ownerUserId !== ownerUserId) return null;
    if (record.status === "pending") {
      const claimed = {
        ...record,
        status: "finalizing" as const,
        expiresAt: finalizationExpiresAt,
        updatedAt: new Date().toISOString()
      };
      this.sessions.set(sessionId, claimed);
      return { outcome: "claimed", session: claimed };
    }
    if (record.status === "completed") return { outcome: "completed", session: record };
    if (record.status === "failed") return { outcome: "failed", session: record };
    return { outcome: "in_progress", session: record };
  }

  private createDeploymentVersion(input: CreateVersionInput): DeploymentWithVersion {
    const existing = this.deployments.get(`${input.namespace}/${input.slug}`);
    if (existing) throw new Error("Version already exists.");
    const now = new Date().toISOString();
    const deployment: DeploymentWithVersion = {
      family: {
        id: `dep_${this.deployments.size + 1}`,
        namespaceId: `nsp_${input.namespace}`,
        namespaceName: input.namespace,
        slug: input.slug,
        ownerUserId: input.ownerUserId,
        latestVersionId: input.versionId!,
        visibility: input.visibility,
        createdAt: now,
        updatedAt: now
      },
      version: {
        id: input.versionId!,
        familyId: `dep_${this.deployments.size + 1}`,
        versionNumber: 1,
        createdByUserId: input.ownerUserId,
        manifestHash: input.manifestHash,
        fileCount: input.files.length,
        totalBytes: input.files.reduce((total, file) => total + file.size, 0),
        createdAt: now
      }
    };
    this.deployments.set(`${input.namespace}/${input.slug}`, deployment);
    return deployment;
  }
}

class MemoryDirectStorage implements ArtifactStorage {
  readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();
  readonly directUpload?: DirectUploadCapability;
  readonly deletedPrefixes: string[] = [];
  getObjectCalls = 0;
  private blockedRead?: { started: () => void; wait: Promise<void> };

  constructor(enabled = true) {
    if (enabled) this.directUpload = { presignPutObject: (request) => this.presignPutObject(request) };
  }

  async putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType });
  }

  async getObject(key: string): Promise<ArtifactObject | null> {
    this.getObjectCalls += 1;
    if (this.blockedRead) {
      const blocked = this.blockedRead;
      this.blockedRead = undefined;
      blocked.started();
      await blocked.wait;
    }
    const object = this.objects.get(key);
    return object ? { body: object.body, contentType: object.contentType, size: object.body.byteLength } : null;
  }

  async deletePrefix(prefix: string): Promise<void> {
    this.deletedPrefixes.push(prefix);
    for (const key of this.objects.keys()) if (key.startsWith(prefix)) this.objects.delete(key);
  }

  private async presignPutObject(request: DirectUploadRequest): Promise<PresignedUploadTarget> {
    return {
      url: `https://storage.example.test/${encodeURIComponent(request.key)}`,
      method: "PUT",
      headers: {
        "content-type": request.contentType,
        "x-amz-meta-sha256": request.sha256
      },
      expiresAt: new Date(Date.now() + request.expiresInSeconds * 1000).toISOString()
    };
  }

  async upload(url: string, body: Uint8Array, headers: Record<string, string>) {
    const key = decodeURIComponent(new URL(url).pathname.slice(1));
    await this.putObject(key, body, headers["content-type"]!);
  }

  blockNextRead(): { started: Promise<void>; release: () => void } {
    let signalStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    this.blockedRead = { started: signalStarted, wait };
    return { started, release };
  }
}

const noopBrowserAuth: BrowserAuth = {
  handler: () => new Response("not found", { status: 404 }),
  api: { getSession: async () => null }
};
