import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import {
  AuthRejectedError,
  authenticateRequest,
  createSessionForUser,
  emailAllowed,
  loadAuthConfig,
  normalizeEmail,
  sessionCookie,
  type AuthenticatedUser,
  type OpenDropAuthConfig
} from "@opendrop/shared/auth";
import {
  annotationInputSchema,
  annotationIdParamSchema,
  annotationQuerySchema,
  annotationResolveInputSchema,
  cliConnectionParamsSchema,
  cliTokenBodySchema,
  deploymentRefSchema,
  devLoginBodySchema,
  devLoginParamsSchema,
  deviceCodeBodySchema,
  deviceDecisionBodySchema,
  deviceRequestParamsSchema,
  deviceTokenBodySchema,
  DEFAULT_VALIDATION_LIMITS,
  filesFromZip,
  manifestHash,
  namespaceCreateBodySchema,
  namespacePublisherBodySchema,
  namespacePublisherRouteParamsSchema,
  namespaceRouteParamsSchema,
  normalizeArtifactPath,
  pageQuerySchema,
  pagePathToArtifactPath,
  normalizeUploadRoot,
  randomId,
  randomSlug,
  safeReturnQuerySchema,
  uploadMetadataSchema,
  storageKey,
  visibilityUpdateBodySchema,
  versionedDeploymentRefSchema,
  validateUploadFiles,
  ZipUploadLimitError,
  type UploadFileLike
} from "@opendrop/shared/core";
import type { OpenDropRepository } from "@opendrop/shared/db/repository";
import { createRawCliToken, createRawDeviceCode, createUserCode, hashToken } from "@opendrop/shared/db/tokens";
import type { AnnotationRecord, UserRecord } from "@opendrop/shared/db/types";
import type { ArtifactStorage } from "@opendrop/shared/storage/interface";
import type { BrowserAuth } from "@/auth";
import { injectAnnotationBridge, rewritePreviewHtml } from "@/annotation-bridge";
import { artifactBody, artifactResponseHeaders, streamToText } from "@/artifact-http";
export { registerDeploymentPageRoutes } from "@/deployment-pages";
import type { AppBindings, CreateAppOptions, OpenDropContext } from "@/app-types";

const submittedFormFileSchema = z.custom<File>(
  (value): value is File => typeof value === "object" && value !== null && "arrayBuffer" in value && "name" in value,
  { message: "Expected an uploaded file." }
);
const submittedFormFilesSchema = z.array(submittedFormFileSchema);
const MAX_UPLOAD_REQUEST_BYTES = DEFAULT_VALIDATION_LIMITS.maxTotalBytes + 10 * 1024 * 1024;

export function createOpenDropApp({ repo, storage, browserAuth, authConfig, trustedSourceHost, trustedSourceIp }: CreateAppOptions) {
  const app = new Hono<AppBindings>();

  app.use("*", cors({ origin: "*", credentials: true }));
  app.on(["GET", "POST"], "/api/auth/*", (c) => browserAuth.handler(c.req.raw));
  app.use("*", async (c, next) => {
    let user: AuthenticatedUser | null = null;
    let authError: { message: string; status: number } | null = null;
    try {
      user =
        (await authenticateRequest(c.req.raw, sourceFromContext(c, trustedSourceHost, trustedSourceIp), repo, authConfig)) ??
        (await authenticateBetterAuthSession(c.req.raw, repo, browserAuth, authConfig));
    } catch (error) {
      if (error instanceof AuthRejectedError) {
        return c.json({ error: error.message }, contentfulStatus(error.status));
      } else {
        throw error;
      }
    }
    c.set("user", user);
    c.set("authError", authError);
    await next();
  });

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.get("/__dev", (c) => {
    const dev = requireDevMode(c);
    if (dev instanceof Response) return dev;
    return c.json({
      ok: true,
      authMode: authConfig.authMode,
      endpoints: {
        preflight: "/__dev/preflight",
        logIn: "/__dev/log-me-in/:email?returnTo=/",
        logOut: "/__dev/log-me-out"
      }
    });
  });

  app.get("/__dev/preflight", async (c) => {
    const dev = requireDevMode(c);
    if (dev instanceof Response) return dev;
    const checks: Record<string, { ok: boolean; detail?: string }> = {
      devMode: { ok: authConfig.authMode === "dev", detail: `authMode=${authConfig.authMode}` },
      repository: { ok: false },
      storage: { ok: false }
    };

    try {
      await repo.getNamespace("__opendrop_preflight__");
      checks.repository = { ok: true };
    } catch (error) {
      checks.repository = { ok: false, detail: errorMessage(error) };
    }

    const probePrefix = `__dev/${randomId("pre_")}/`;
    const probeKey = `${probePrefix}probe.txt`;
    try {
      await storage.putObject(probeKey, new TextEncoder().encode("ok"), "text/plain");
      const object = await storage.getObject(probeKey);
      checks.storage = { ok: Boolean(object), detail: object ? undefined : "probe object not readable" };
    } catch (error) {
      checks.storage = { ok: false, detail: errorMessage(error) };
    } finally {
      await storage.deletePrefix(probePrefix).catch(() => undefined);
    }

    const ok = Object.values(checks).every((check) => check.ok);
    return c.json({ ok, checks, currentUser: c.get("user")?.user ?? null }, ok ? 200 : 503);
  });

  app.get("/__dev/log-me-in/:email", async (c) => {
    const dev = requireDevMode(c);
    if (dev instanceof Response) return dev;
    const params = devLoginParamsSchema.safeParse(c.req.param());
    if (!params.success) return validationError(c, params.error);
    const query = safeReturnQuerySchema.safeParse(queryObject(c.req.url));
    if (!query.success) return validationError(c, query.error);
    const email = normalizeEmail(params.data.email);
    if (!email || !emailAllowed(email, authConfig.allowedEmailDomains)) {
      return c.json({ error: "Invalid or disallowed email." }, 400);
    }
    const user = await repo.getOrCreateUser({
      provider: "dev",
      subject: email,
      email,
      name: query.data.name ?? "Dev User"
    });
    const token = await createSessionForUser(repo, user.id, "dev-browser-session");
    c.header("Set-Cookie", sessionCookie(token));
    if (wantsJson(c.req.raw)) return c.json({ user, token });
    return c.redirect(safeReturnTo(query.data.returnTo));
  });

  app.get("/__dev/log-me-out", (c) => {
    const dev = requireDevMode(c);
    if (dev instanceof Response) return dev;
    const query = safeReturnQuerySchema.safeParse(queryObject(c.req.url));
    if (!query.success) return validationError(c, query.error);
    c.header("Set-Cookie", sessionCookie("", 0));
    if (wantsJson(c.req.raw)) return c.json({ ok: true });
    return c.redirect(safeReturnTo(query.data.returnTo));
  });

  app.get("/api/session", (c) => {
    const auth = c.get("user");
    return c.json({
      authenticated: Boolean(auth),
      authMode: auth?.authMode ?? authConfig.authMode,
      user: auth?.user ?? null,
      defaultVisibility: authConfig.defaultVisibility,
      oauthProviders: authConfig.oauthProviders,
      loginUrl: authConfig.trustedHeader?.loginUrl ?? null
    });
  });

  app.post("/api/dev/login", async (c) => {
    if (authConfig.authMode !== "dev") {
      return c.json({ error: "Dev login is disabled." }, 404);
    }
    const body = devLoginBodySchema.safeParse(await jsonObject(c));
    if (!body.success) return validationError(c, body.error);
    const email = normalizeEmail(body.data.email);
    if (!email) return c.json({ error: "Invalid email." }, 400);
    const user = await repo.getOrCreateUser({
      provider: "dev",
      subject: email,
      email,
      name: body.data.name
    });
    const token = await createSessionForUser(repo, user.id, "dev-browser-session");
    c.header("Set-Cookie", sessionCookie(token));
    return c.json({ user, token });
  });

  app.post("/api/cli/tokens", async (c) => {
    const auth = requireAuth(c);
    if (auth instanceof Response) return auth;
    const body = cliTokenBodySchema.safeParse(await jsonObject(c));
    if (!body.success) return validationError(c, body.error);
    const token = createRawCliToken();
    await repo.createCliToken(auth.user.id, await hashToken(token), body.data.label);
    return c.json({ token });
  });

  app.get("/api/cli/connections", async (c) => {
    const auth = requireAuth(c);
    if (auth instanceof Response) return auth;
    const connections = await repo.listCliTokens(auth.user.id);
    return c.json({ connections: connections.filter((connection) => connection.label !== "dev-browser-session") });
  });

  app.post("/api/cli/connections/:id/revoke", async (c) => {
    const auth = requireAuth(c);
    if (auth instanceof Response) return auth;
    const params = cliConnectionParamsSchema.safeParse(c.req.param());
    if (!params.success) return validationError(c, params.error);
    await repo.revokeCliToken(auth.user.id, params.data.id);
    return c.json({ ok: true });
  });

  app.get("/api/cli/whoami", (c) => {
    const auth = requireAuth(c);
    if (auth instanceof Response) return auth;
    return c.json({ user: auth.user, authMode: auth.authMode, defaultNamespace: auth.user.defaultNamespace });
  });

  app.get("/api/namespaces", async (c) => {
    const auth = requireAuth(c);
    if (auth instanceof Response) return auth;
    return c.json({ namespaces: await repo.listNamespacesForUser(auth.user.id) });
  });

  app.post("/api/namespaces", async (c) => {
    const auth = requireAuth(c);
    if (auth instanceof Response) return auth;
    const body = namespaceCreateBodySchema.safeParse(await jsonObject(c));
    if (!body.success) return validationError(c, body.error);
    const namespace = await repo.createNamespace(body.data.name, auth.user.id).catch((error) => repositoryMutationError(c, error));
    if (namespace instanceof Response) return namespace;
    return c.json({ namespace }, 201);
  });

  app.get("/api/namespaces/:namespace/members", async (c) => {
    const auth = requireAuth(c);
    if (auth instanceof Response) return auth;
    const params = namespaceRouteParamsSchema.safeParse(c.req.param());
    if (!params.success) return validationError(c, params.error);
    const members = await repo.listNamespaceMembers(params.data.namespace, auth.user.id).catch((error) => repositoryMutationError(c, error));
    if (members instanceof Response) return members;
    return c.json({ members });
  });

  app.post("/api/namespaces/:namespace/publishers", async (c) => {
    const auth = requireAuth(c);
    if (auth instanceof Response) return auth;
    const params = namespaceRouteParamsSchema.safeParse(c.req.param());
    if (!params.success) return validationError(c, params.error);
    const body = namespacePublisherBodySchema.safeParse(await jsonObject(c));
    if (!body.success) return validationError(c, body.error);
    const member = await repo.addNamespacePublisher(params.data.namespace, auth.user.id, body.data.email).catch((error) => repositoryMutationError(c, error));
    if (member instanceof Response) return member;
    return c.json({ member }, 201);
  });

  app.delete("/api/namespaces/:namespace/publishers/:userId", async (c) => {
    const auth = requireAuth(c);
    if (auth instanceof Response) return auth;
    const params = namespacePublisherRouteParamsSchema.safeParse(c.req.param());
    if (!params.success) return validationError(c, params.error);
    const removed = await repo
      .removeNamespacePublisher(params.data.namespace, auth.user.id, params.data.userId)
      .then(() => ({ ok: true }))
      .catch((error) => repositoryMutationError(c, error));
    if (removed instanceof Response) return removed;
    return c.json(removed);
  });

  app.post("/api/device/code", async (c) => {
    const body = deviceCodeBodySchema.safeParse(await jsonObject(c));
    if (!body.success) return validationError(c, body.error);
    const deviceCode = createRawDeviceCode();
    const userCode = createUserCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await repo.createDeviceAuthorization({
      deviceCodeHash: await hashToken(deviceCode),
      userCode,
      label: body.data.label,
      deviceName: body.data.deviceName,
      userAgent: c.req.header("user-agent") || undefined,
      expiresAt
    });
    const baseUrl = new URL(c.req.url).origin;
    return c.json({
      deviceCode,
      userCode,
      verificationUri: `${baseUrl}/device`,
      verificationUriComplete: `${baseUrl}/device?user_code=${encodeURIComponent(userCode)}`,
      expiresAt,
      interval: 2
    });
  });

  app.get("/api/device/requests/:userCode", async (c) => {
    const auth = requireAuth(c);
    if (auth instanceof Response) return auth;
    const params = deviceRequestParamsSchema.safeParse(c.req.param());
    if (!params.success) return validationError(c, params.error);
    const request = await repo.getDeviceAuthorizationByUserCode(params.data.userCode);
    if (!request) return c.json({ error: "Device request not found." }, 404);
    return c.json({ request });
  });

  app.post("/api/device/approve", async (c) => {
    const auth = requireAuth(c);
    if (auth instanceof Response) return auth;
    const body = deviceDecisionBodySchema.safeParse(await jsonObject(c));
    if (!body.success) return validationError(c, body.error);
    if (body.data.decision === "reject") {
      await repo.rejectDeviceAuthorization(body.data.userCode, auth.user.id);
      return c.json({ ok: true, status: "rejected" });
    }
    const token = createRawCliToken();
    await repo.approveDeviceAuthorization(body.data.userCode, auth.user.id, await hashToken(token), token);
    return c.json({ ok: true, status: "approved" });
  });

  app.post("/api/device/token", async (c) => {
    const body = deviceTokenBodySchema.safeParse(await jsonObject(c));
    if (!body.success) return validationError(c, body.error);
    const exchanged = await repo.exchangeDeviceAuthorization(await hashToken(body.data.deviceCode));
    if (!exchanged) return c.json({ error: "Invalid device code." }, 400);
    if (new Date(exchanged.expiresAt).getTime() < Date.now()) return c.json({ error: "expired_token" }, 400);
    if (exchanged.status === "pending") return c.json({ error: "authorization_pending" }, 428);
    if (exchanged.status === "rejected") return c.json({ error: "access_denied" }, 403);
    if (!exchanged.tokenPlain) return c.json({ error: "token_already_exchanged" }, 400);
    return c.json({ accessToken: exchanged.tokenPlain, tokenType: "Bearer" });
  });

  app.post("/api/uploads/validate", async (c) => {
    const auth = requireAuth(c);
    if (auth instanceof Response) return auth;
    const files = await filesFromForm(c);
    if (files instanceof Response) return files;
    const validation = await validateUploadFiles(files);
    return c.json(validation, validation.ok ? 200 : 422);
  });

  app.post("/api/uploads/publish", async (c) => {
    const auth = requireAuth(c);
    if (auth instanceof Response) return auth;
    const uploadSizeError = oversizedUploadError(c);
    if (uploadSizeError) return uploadSizeError;
    const form = await c.req.formData();
    const metadata = uploadMetadataSchema.safeParse(formMetadata(form));
    if (!metadata.success) return validationError(c, metadata.error);
    const namespace = metadata.data.namespace ?? auth.user.defaultNamespace;
    const slug = metadata.data.slug ?? randomSlug();
    const visibility = metadata.data.visibility ?? authConfig.defaultVisibility;
    if (!(await repo.userCanPublishNamespace(auth.user.id, namespace))) {
      return c.json({ error: "You do not have publish access to this namespace." }, 403);
    }
    const submittedFiles = await filesFromSubmittedForm(c, form);
    if (submittedFiles instanceof Response) return submittedFiles;
    const files = normalizeUploadRoot(submittedFiles);
    const validation = await validateUploadFiles(files);
    if (!validation.ok) return c.json(validation, 422);

    const plannedVersionId = randomId("ver_");
    const uploadPrefix = storageKey(namespace, slug, plannedVersionId, "");
    const fileBytesByPath = fileBytesByNormalizedPath(files);
    const filesWithKeys = validation.acceptedFiles.map((file) => ({
      ...file,
      storageKey: storageKey(namespace, slug, plannedVersionId, file.path)
    }));
    const computedManifestHash = await manifestHash(validation.acceptedFiles);
    let attemptedStorageWrite = false;
    try {
      for (const file of filesWithKeys) {
        const bytes = fileBytesByPath.get(file.path);
        if (!bytes) throw new Error(`Missing bytes for ${file.path}`);
        attemptedStorageWrite = true;
        await storage.putObject(file.storageKey, bytes, file.contentType);
      }
    } catch {
      if (attemptedStorageWrite) await storage.deletePrefix(uploadPrefix).catch(() => undefined);
      return c.json({ error: "Artifact storage write failed." }, 502);
    }

    const version = await repo
      .createDeploymentVersion({
        namespace,
        slug,
        versionId: plannedVersionId,
        ownerUserId: auth.user.id,
        visibility,
        manifestHash: computedManifestHash,
        files: filesWithKeys
      })
      .catch((error) => repositoryMutationError(c, error));
    if (version instanceof Response) {
      await storage.deletePrefix(uploadPrefix).catch(() => undefined);
      return version;
    }

    return c.json({
      namespace,
      slug,
      visibility,
      url: `/${namespace}/${slug}`,
      versionUrl: `/${namespace}/${slug}/versions/${version.version.id}`,
      family: version.family,
      version: version.version,
      validation
    });
  });

  app.get("/api/deployments/:namespace/:slug", async (c) => {
    const params = deploymentRefSchema.safeParse(c.req.param());
    if (!params.success) return validationError(c, params.error);
    const deployment = await repo.getDeploymentVersion(params.data.namespace, params.data.slug);
    if (!deployment) return c.json({ error: "Deployment not found." }, 404);
    const access = await ensureCanView(c, deployment.family.visibility);
    if (access instanceof Response) return access;
    return c.json({
      family: deployment.family,
      version: deployment.version,
      versions: await repo.listDeploymentVersions(deployment.family.namespaceName, deployment.family.slug)
    });
  });

  app.get("/api/deployments/:namespace/:slug/versions", async (c) => {
    const params = deploymentRefSchema.safeParse(c.req.param());
    if (!params.success) return validationError(c, params.error);
    const family = await repo.getDeploymentFamily(params.data.namespace, params.data.slug);
    if (!family) return c.json({ error: "Deployment not found." }, 404);
    const access = await ensureCanView(c, family.visibility);
    if (access instanceof Response) return access;
    return c.json({ versions: await repo.listDeploymentVersions(family.namespaceName, family.slug), latestVersionId: family.latestVersionId });
  });

  app.post("/api/deployments/:namespace/:slug/versions/:versionId/restore", async (c) => {
    const auth = requireAuth(c);
    if (auth instanceof Response) return auth;
    const params = versionedDeploymentRefSchema.safeParse(c.req.param());
    if (!params.success) return validationError(c, params.error);
    const restored = await repo
      .restoreDeploymentVersion(params.data.namespace, params.data.slug, params.data.versionId, auth.user.id)
      .catch((error) => repositoryMutationError(c, error));
    if (restored instanceof Response) return restored;
    return c.json(restored);
  });

  app.patch("/api/deployments/:namespace/:slug/visibility", async (c) => {
    const auth = requireAuth(c);
    if (auth instanceof Response) return auth;
    const params = deploymentRefSchema.safeParse(c.req.param());
    if (!params.success) return validationError(c, params.error);
    const body = visibilityUpdateBodySchema.safeParse(await jsonObject(c));
    if (!body.success) return validationError(c, body.error);
    const family = await repo.setDeploymentVisibility(params.data.namespace, params.data.slug, body.data.visibility, auth.user.id).catch((error) => repositoryMutationError(c, error));
    if (family instanceof Response) return family;
    return c.json({ family });
  });

  app.get("/api/deployments/:namespace/:slug/page", async (c) => {
    const params = deploymentRefSchema.safeParse(c.req.param());
    if (!params.success) return validationError(c, params.error);
    const query = pageQuerySchema.safeParse(queryObject(c.req.url));
    if (!query.success) return validationError(c, query.error);
    const deployment = await repo.getDeploymentVersion(params.data.namespace, params.data.slug, query.data.versionId);
    if (!deployment) return c.json({ error: "Deployment not found." }, 404);
    const access = await ensureCanView(c, deployment.family.visibility);
    if (access instanceof Response) return access;
    const artifactPath = pagePathToArtifactPath(query.data.path);
    const file = await repo.getDeploymentFile(deployment.version.id, artifactPath);
    const object = file ? await storage.getObject(file.storageKey) : null;
    const html = object ? await streamToText(object.body) : null;
    const annotations = await withAnnotationAuthors(
      repo,
      await repo.listAnnotations(deployment.family.namespaceName, deployment.family.slug, deployment.version.id, query.data.path)
    );
    return c.json({ deployment, path: query.data.path, artifactPath, html, annotations });
  });

  app.post("/api/deployments/:namespace/:slug/annotations", async (c) => {
    const auth = requireAuth(c);
    if (auth instanceof Response) return auth;
    const params = deploymentRefSchema.safeParse(c.req.param());
    if (!params.success) return validationError(c, params.error);
    const input = annotationInputSchema.safeParse(await jsonObject(c));
    if (!input.success) return validationError(c, input.error);
    const [annotation] = await withAnnotationAuthors(repo, [
      await repo.createAnnotation(params.data.namespace, params.data.slug, input.data, auth.user.id)
    ]);
    return c.json({ annotation }, 201);
  });

  app.patch("/api/deployments/:namespace/:slug/annotations/:annotationId", async (c) => {
    const auth = requireAuth(c);
    if (auth instanceof Response) return auth;
    const params = deploymentRefSchema.safeParse(c.req.param());
    if (!params.success) return validationError(c, params.error);
    const annotationParams = annotationIdParamSchema.safeParse(c.req.param());
    if (!annotationParams.success) return validationError(c, annotationParams.error);
    const input = annotationResolveInputSchema.safeParse(await jsonObject(c));
    if (!input.success) return validationError(c, input.error);
    const [annotation] = await withAnnotationAuthors(
      repo,
      [
        await repo.setAnnotationResolved(
          params.data.namespace,
          params.data.slug,
          annotationParams.data.annotationId,
          input.data.resolved,
          auth.user.id
        )
      ]
    );
    return c.json({ annotation });
  });

  app.get("/api/deployments/:namespace/:slug/annotations", async (c) => {
    const params = deploymentRefSchema.safeParse(c.req.param());
    if (!params.success) return validationError(c, params.error);
    const query = annotationQuerySchema.safeParse(queryObject(c.req.url));
    if (!query.success) return validationError(c, query.error);
    const deployment = await repo.getDeploymentVersion(params.data.namespace, params.data.slug, query.data.versionId);
    if (!deployment) return c.json({ error: "Deployment not found." }, 404);
    const access = await ensureCanView(c, deployment.family.visibility);
    if (access instanceof Response) return access;
    const annotations = await withAnnotationAuthors(
      repo,
      await repo.listAnnotations(
        deployment.family.namespaceName,
        deployment.family.slug,
        deployment.version.id,
        query.data.path
      )
    );
    return c.json({ annotations });
  });

  app.get("/preview/:namespace/:slug/:versionId/*", async (c) => {
    const params = versionedDeploymentRefSchema.safeParse(c.req.param());
    if (!params.success) return validationError(c, params.error);
    const deployment = await repo.getDeploymentVersion(
      params.data.namespace,
      params.data.slug,
      params.data.versionId === "latest" ? undefined : params.data.versionId
    );
    if (!deployment) return c.text("Not found", 404);
    const access = await ensureCanView(c, deployment.family.visibility);
    if (access instanceof Response) return access;
    const requestedPath = pathAfterPrefix(c.req.url, `/preview/${params.data.namespace}/${params.data.slug}/${params.data.versionId}/`);
    const artifactPath = pagePathToArtifactPath(requestedPath);
    const file = await repo.getDeploymentFile(deployment.version.id, artifactPath);
    if (!file) return c.text("Not found", 404);
    const object = await storage.getObject(file.storageKey);
    if (!object) return c.text("Not found", 404);
    if (object.contentType.includes("text/html")) {
      const html = await streamToText(object.body);
      const base = `/preview/${params.data.namespace}/${params.data.slug}/${params.data.versionId}/`;
      return new Response(injectAnnotationBridge(rewritePreviewHtml(html, base)), {
        headers: artifactResponseHeaders(object.contentType, "public, max-age=60")
      });
    }
    return new Response(artifactBody(object.body), {
      headers: artifactResponseHeaders(object.contentType, "public, max-age=60")
    });
  });

  return app;

  async function ensureCanView(c: OpenDropContext, visibility: string): Promise<true | Response> {
    if (visibility === "public") return true;
    if (c.get("user")) return true;
    const authError = c.get("authError");
    if (authError) return c.json({ error: authError.message }, contentfulStatus(authError.status));
    const loginUrl = authConfig.trustedHeader?.loginUrl;
    if (loginUrl && c.req.header("accept")?.includes("text/html")) {
      return c.redirect(loginUrl);
    }
    return c.json({ error: "Authentication required for private preview." }, 401);
  }

  function requireAuth(c: OpenDropContext): AuthenticatedUser | Response {
    const authError = c.get("authError");
    if (authError) return c.json({ error: authError.message }, contentfulStatus(authError.status));
    const auth = c.get("user");
    if (!auth) return c.json({ error: "Authentication required." }, 401);
    return auth;
  }

  function requireDevMode(c: OpenDropContext): true | Response {
    if (authConfig.authMode === "dev") return true;
    return c.text("404 Not Found", 404);
  }
}

async function authenticateBetterAuthSession(
  request: Request,
  repo: OpenDropRepository,
  browserAuth: BrowserAuth,
  authConfig: OpenDropAuthConfig
): Promise<AuthenticatedUser | null> {
  const session = await browserAuth.api.getSession({ headers: request.headers }).catch(() => null);
  if (!session?.user?.email) return null;
  const email = normalizeEmail(session.user.email);
  if (!email || !emailAllowed(email, authConfig.allowedEmailDomains)) return null;
  const account = await browserAuth.resolveOAuthAccount?.(session.user.id).catch(() => null);
  if (!account) return null;
  const user = await repo.getOrCreateUser({
    provider: "oauth",
    subject: `${account.providerId}:${account.accountId}`,
    email,
    name: session.user.name ?? null,
    avatarUrl: session.user.image ?? null
  });
  return { user, authMode: "oauth" };
}

async function filesFromForm(c: OpenDropContext): Promise<UploadFileLike[] | Response> {
  const uploadSizeError = oversizedUploadError(c);
  if (uploadSizeError) return uploadSizeError;
  return filesFromSubmittedForm(c, await c.req.raw.formData());
}

async function filesFromSubmittedForm(c: OpenDropContext, form: FormData): Promise<UploadFileLike[] | Response> {
  const parsedFiles = submittedFormFilesSchema.safeParse(form.getAll("files"));
  if (!parsedFiles.success) return validationError(c, parsedFiles.error);
  const files = parsedFiles.data;
  if (files.length === 1 && (files[0].name.endsWith(".zip") || files[0].type === "application/zip")) {
    const zipSizeError = oversizedSubmittedZipError(c, files[0]);
    if (zipSizeError) return zipSizeError;
    try {
      return filesFromZip(new Uint8Array(await files[0].arrayBuffer()), DEFAULT_VALIDATION_LIMITS);
    } catch (error) {
      if (error instanceof ZipUploadLimitError) return c.json({ error: error.message }, 413);
      return c.json({ error: "Invalid zip upload." }, 400);
    }
  }
  const submittedFilesSizeError = oversizedSubmittedFilesError(c, files);
  if (submittedFilesSizeError) return submittedFilesSizeError;
  return Promise.all(
    files.map(async (file) => ({
      path: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      contentType: file.type || undefined
    }))
  );
}

function oversizedUploadError(c: OpenDropContext): Response | null {
  const rawContentLength = c.req.header("content-length");
  if (!rawContentLength) return null;
  const contentLength = Number(rawContentLength);
  if (!Number.isFinite(contentLength) || contentLength <= MAX_UPLOAD_REQUEST_BYTES) return null;
  return c.json({ error: `Upload request exceeds ${MAX_UPLOAD_REQUEST_BYTES} bytes.` }, 413);
}

function oversizedSubmittedZipError(c: OpenDropContext, file: File): Response | null {
  if (file.size <= MAX_UPLOAD_REQUEST_BYTES) return null;
  return c.json({ error: `Zip upload exceeds ${MAX_UPLOAD_REQUEST_BYTES} bytes.` }, 413);
}

function oversizedSubmittedFilesError(c: OpenDropContext, files: File[]): Response | null {
  let totalSize = 0;
  for (const file of files) {
    if (file.size > DEFAULT_VALIDATION_LIMITS.maxFileBytes) {
      return c.json({ error: `File ${file.name} exceeds ${DEFAULT_VALIDATION_LIMITS.maxFileBytes} bytes.` }, 413);
    }
    totalSize += file.size;
    if (totalSize > DEFAULT_VALIDATION_LIMITS.maxTotalBytes) {
      return c.json({ error: `Upload files exceed ${DEFAULT_VALIDATION_LIMITS.maxTotalBytes} bytes.` }, 413);
    }
  }
  return null;
}

function fileBytesByNormalizedPath(files: UploadFileLike[]): Map<string, Uint8Array> {
  const bytesByPath = new Map<string, Uint8Array>();
  for (const file of files) {
    const normalizedPath = normalizeArtifactPath(file.path);
    if (normalizedPath) bytesByPath.set(normalizedPath, file.bytes);
  }
  return bytesByPath;
}

function sourceFromContext(c: OpenDropContext, trustedSourceHost?: string, trustedSourceIp?: string | null): { ip: string | null; host?: string | null } {
  return {
    ip: trustedSourceIp ?? c.env?.incoming?.socket?.remoteAddress ?? null,
    host: trustedSourceHost ?? null
  };
}

function pathAfterPrefix(url: string, prefix: string): string {
  const pathname = new URL(url).pathname;
  if (!pathname.startsWith(prefix)) return "index.html";
  const suffix = pathname.slice(prefix.length);
  return suffix || "index.html";
}


async function withAnnotationAuthors(
  repo: OpenDropRepository,
  annotations: AnnotationRecord[]
): Promise<Array<AnnotationRecord & { author: Pick<UserRecord, "email" | "name"> | null }>> {
  const userIds = [...new Set(annotations.map((annotation) => annotation.authorUserId))];
  const users = new Map<string, UserRecord | null>();
  await Promise.all(
    userIds.map(async (userId) => {
      users.set(userId, await repo.getUserById(userId));
    })
  );

  return annotations.map((annotation) => {
    const user = users.get(annotation.authorUserId);
    return {
      ...annotation,
      author: user ? { email: user.email, name: user.name } : null
    };
  });
}

async function jsonObject(c: OpenDropContext): Promise<unknown> {
  return c.req.json().catch(() => ({}));
}

function queryObject(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url).searchParams.entries());
}

function formMetadata(form: FormData): Record<string, string | undefined> {
  return {
    namespace: formString(form, "namespace"),
    slug: formString(form, "slug"),
    visibility: formString(form, "visibility")
  };
}

function formString(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function validationError(c: OpenDropContext, error: unknown): Response {
  return c.json({ error: "Invalid request.", issues: zodIssues(error) }, 400);
}

function repositoryMutationError(c: OpenDropContext, error: unknown): Response {
  const message = errorMessage(error);
  if (/only .*owner/i.test(message)) return c.json({ error: message }, 403);
  if (/not found/i.test(message)) return c.json({ error: message }, 404);
  if (/already exists/i.test(message)) return c.json({ error: message }, 409);
  return c.json({ error: message }, 400);
}

function zodIssues(error: unknown): Array<{ path: string; message: string }> {
  const issues = typeof error === "object" && error !== null && "issues" in error ? (error as { issues?: unknown }).issues : null;
  if (!Array.isArray(issues)) return [{ path: "", message: errorMessage(error) }];
  return issues.map((issue) => {
    const item = issue as { path?: Array<string | number>; message?: string };
    return {
      path: item.path?.join(".") ?? "",
      message: item.message ?? "Invalid value."
    };
  });
}

function wantsJson(request: Request): boolean {
  const url = new URL(request.url);
  return url.searchParams.get("json") === "1" || request.headers.get("accept")?.includes("application/json") === true;
}

function safeReturnTo(returnTo: string | undefined): string {
  if (!returnTo) return "/";
  if (!returnTo.startsWith("/") || returnTo.startsWith("//")) return "/";
  return returnTo;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function contentfulStatus(status: number): ContentfulStatusCode {
  switch (status) {
    case 400:
      return 400;
    case 401:
      return 401;
    case 403:
      return 403;
    default:
      return 403;
  }
}
