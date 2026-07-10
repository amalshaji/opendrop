import type { Hono } from "hono";
import {
  DIRECT_UPLOAD_URL_TTL_SECONDS,
  UPLOAD_SESSION_TTL_MS,
  manifestHash,
  randomId,
  randomSlug,
  sha256Hex,
  storageKey,
  uploadSessionCreateBodySchema,
  uploadSessionParamsSchema,
  uploadSessionUrlsBodySchema,
  validationResultForManifest
} from "@opendrop/shared/core";
import type { OpenDropAuthConfig } from "@opendrop/shared/auth";
import type { CreateVersionInput, OpenDropRepository } from "@opendrop/shared/db/repository";
import type { DeploymentWithVersion, UploadSessionRecord } from "@opendrop/shared/db/types";
import type { ArtifactObject, ArtifactStorage } from "@opendrop/shared/storage/interface";
import type { AppBindings, OpenDropContext } from "@/app-types";
import { repositoryMutationError, requireAuth, validationError } from "@/http-helpers";
import { publishResponse } from "@/upload-response";

interface UploadSessionRouteOptions {
  repo: OpenDropRepository;
  storage: ArtifactStorage;
  authConfig: OpenDropAuthConfig;
}

export function registerUploadSessionRoutes(
  app: Hono<AppBindings>,
  { repo, storage, authConfig }: UploadSessionRouteOptions
) {
  app.post("/api/uploads/sessions", async (c) => {
    const auth = requireAuth(c);
    if (auth instanceof Response) return auth;
    if (!storage.directUploadEnabled || !storage.presignPutObject) {
      return directUploadUnavailable(c);
    }
    const rawBody = await c.req.json().catch(() => null);
    const body = uploadSessionCreateBodySchema.safeParse(rawBody);
    if (!body.success) return validationError(c, body.error);
    const namespace = body.data.namespace ?? auth.user.defaultNamespace;
    const slug = body.data.slug ?? randomSlug();
    const visibility = body.data.visibility ?? authConfig.defaultVisibility;
    if (!(await repo.userCanPublishNamespace(auth.user.id, namespace))) {
      return c.json({ error: "You do not have publish access to this namespace." }, 403);
    }
    const versionId = randomId("ver_");
    const sessionId = randomId("upl_");
    const expiresAt = new Date(Date.now() + UPLOAD_SESSION_TTL_MS).toISOString();
    const record = await repo
      .createUploadSession({
        id: sessionId,
        ownerUserId: auth.user.id,
        namespace,
        slug,
        visibility,
        versionId,
        manifestHash: await manifestHash(body.data.manifest),
        manifest: body.data.manifest,
        expiresAt
      })
      .catch((error) => repositoryMutationError(c, error));
    if (record instanceof Response) return record;
    return c.json({ sessionId, versionId, namespace, slug, visibility, expiresAt }, 201);
  });

  app.post("/api/uploads/sessions/:sessionId/urls", async (c) => {
    const auth = requireAuth(c);
    if (auth instanceof Response) return auth;
    const params = uploadSessionParamsSchema.safeParse(c.req.param());
    if (!params.success) return validationError(c, params.error);
    const body = uploadSessionUrlsBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return validationError(c, body.error);
    const session = await repo.getUploadSessionForOwner(params.data.sessionId, auth.user.id);
    if (!session) return c.json({ error: "Upload session not found." }, 404);
    const unavailable = unavailableSessionResponse(c, session);
    if (unavailable) {
      if (session.status === "pending" && sessionExpired(session)) await failAndClean(repo, storage, session, "Upload session expired.");
      return unavailable;
    }
    if (!storage.directUploadEnabled || !storage.presignPutObject) {
      return c.json({ error: "Direct upload signing became unavailable." }, 503);
    }
    const filesByPath = new Map(session.manifest.map((file) => [file.path, file]));
    const unknownPath = body.data.paths.find((path) => !filesByPath.has(path));
    if (unknownPath) return c.json({ error: `Unknown upload path: ${unknownPath}` }, 400);
    const expiresInSeconds = Math.min(
      DIRECT_UPLOAD_URL_TTL_SECONDS,
      Math.max(1, Math.floor((Date.parse(session.expiresAt) - Date.now()) / 1000))
    );
    try {
      const uploads = await Promise.all(body.data.paths.map(async (path) => {
        const file = filesByPath.get(path)!;
        return {
          path,
          ...(await storage.presignPutObject!({
            key: storageKey(session.namespace, session.slug, session.versionId, path),
            contentType: file.contentType,
            sha256: file.sha256,
            expiresInSeconds
          }))
        };
      }));
      return c.json({ uploads });
    } catch {
      return c.json({ error: "Direct upload signing failed." }, 503);
    }
  });

  app.post("/api/uploads/sessions/:sessionId/finalize", async (c) => {
    const auth = requireAuth(c);
    if (auth instanceof Response) return auth;
    const params = uploadSessionParamsSchema.safeParse(c.req.param());
    if (!params.success) return validationError(c, params.error);
    const session = await repo.getUploadSessionForOwner(params.data.sessionId, auth.user.id);
    if (!session) return c.json({ error: "Upload session not found." }, 404);
    if (session.status === "completed" && session.completedResult) {
      return c.json(sessionPublishResponse(session, session.completedResult));
    }
    const unavailable = unavailableSessionResponse(c, session);
    if (unavailable) {
      if (session.status === "pending" && sessionExpired(session)) await failAndClean(repo, storage, session, "Upload session expired.");
      return unavailable;
    }

    const mismatch = await verifyUploadedManifest(storage, session).catch(() => "Artifact storage verification failed.");
    if (mismatch) {
      await failAndClean(repo, storage, session, mismatch);
      return c.json({ error: mismatch }, mismatch === "Artifact storage verification failed." ? 502 : 422);
    }

    const files = session.manifest.map((file) => ({
      ...file,
      storageKey: storageKey(session.namespace, session.slug, session.versionId, file.path)
    }));
    const input: CreateVersionInput = {
      namespace: session.namespace,
      slug: session.slug,
      versionId: session.versionId,
      ownerUserId: session.ownerUserId,
      visibility: session.visibility,
      manifestHash: session.manifestHash,
      files
    };
    const deployment = await createDeploymentVersionIdempotently(repo, input).catch((error) => repositoryMutationError(c, error));
    if (deployment instanceof Response) {
      await failAndClean(repo, storage, session, "Deployment version creation failed.");
      return deployment;
    }
    const completed = await repo.transitionUploadSession({
      sessionId: session.id,
      ownerUserId: session.ownerUserId,
      expectedStatuses: ["pending"],
      status: "completed",
      completedResult: deployment
    });
    const result = completed.completedResult ?? deployment;
    return c.json(sessionPublishResponse(completed, result));
  });
}

async function verifyUploadedManifest(storage: ArtifactStorage, session: UploadSessionRecord): Promise<string | null> {
  for (const file of session.manifest) {
    const object = await storage.getObject(storageKey(session.namespace, session.slug, session.versionId, file.path));
    if (!object) return `Uploaded object is missing: ${file.path}`;
    if (object.size !== undefined && object.size !== file.size) return `Uploaded object size does not match: ${file.path}`;
    if (object.contentType !== file.contentType) return `Uploaded object content type does not match: ${file.path}`;
    const bytes = await objectBytes(object);
    if (bytes.byteLength !== file.size) return `Uploaded object size does not match: ${file.path}`;
    if ((await sha256Hex(bytes)) !== file.sha256) return `Uploaded object checksum does not match: ${file.path}`;
  }
  return null;
}

async function objectBytes(object: ArtifactObject): Promise<Uint8Array> {
  if (object.body instanceof Uint8Array) return object.body;
  return new Uint8Array(await new Response(object.body).arrayBuffer());
}

function unavailableSessionResponse(c: OpenDropContext, session: UploadSessionRecord): Response | null {
  if (session.status === "failed") return c.json({ error: session.failureReason ?? "Upload session failed." }, 409);
  if (sessionExpired(session)) return c.json({ error: "Upload session expired." }, 410);
  return null;
}

function sessionExpired(session: UploadSessionRecord): boolean {
  return Date.parse(session.expiresAt) <= Date.now();
}

async function failAndClean(
  repo: OpenDropRepository,
  storage: ArtifactStorage,
  session: UploadSessionRecord,
  reason: string
): Promise<void> {
  await storage.deletePrefix(storageKey(session.namespace, session.slug, session.versionId, "")).catch(() => undefined);
  await repo.transitionUploadSession({
    sessionId: session.id,
    ownerUserId: session.ownerUserId,
    expectedStatuses: ["pending"],
    status: "failed",
    failureReason: reason
  }).catch(() => undefined);
}

async function createDeploymentVersionIdempotently(
  repo: OpenDropRepository,
  input: CreateVersionInput
): Promise<DeploymentWithVersion> {
  try {
    return await repo.createDeploymentVersion(input);
  } catch (error) {
    const existing = input.versionId
      ? await repo.getDeploymentVersion(input.namespace, input.slug, input.versionId)
      : null;
    if (
      existing &&
      existing.version.createdByUserId === input.ownerUserId &&
      existing.version.manifestHash === input.manifestHash
    ) {
      return existing;
    }
    throw error;
  }
}

function sessionPublishResponse(session: UploadSessionRecord, deployment: DeploymentWithVersion) {
  return publishResponse(
    session.namespace,
    session.slug,
    session.visibility,
    deployment,
    validationResultForManifest(session.manifest)
  );
}

function directUploadUnavailable(c: OpenDropContext) {
  return c.json({ error: "Direct upload sessions are not available.", code: "direct_upload_unavailable" }, 501);
}
