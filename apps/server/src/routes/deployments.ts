import type { Hono } from "hono";
import type { OpenDropAuthConfig } from "@opendrop/shared/auth";
import {
  annotationIdParamSchema,
  annotationInputSchema,
  annotationQuerySchema,
  annotationResolveInputSchema,
  deploymentRefSchema,
  pagePathToArtifactPath,
  pageQuerySchema,
  versionedDeploymentRefSchema,
  visibilityUpdateBodySchema
} from "@opendrop/shared/core";
import type { OpenDropRepository } from "@opendrop/shared/db/repository";
import type { AnnotationRecord, UserRecord } from "@opendrop/shared/db/types";
import type { ArtifactStorage } from "@opendrop/shared/storage/interface";
import { artifactBody, artifactResponseHeaders, streamToText } from "@/artifact-http";
import { injectAnnotationBridge, rewritePreviewHtml } from "@/annotation-bridge";
import type { AppBindings, OpenDropContext } from "@/app-types";
import {
  contentfulStatus,
  jsonObject,
  queryObject,
  repositoryMutationError,
  requireAuth,
  validationError
} from "@/http-helpers";

interface DeploymentRouteOptions {
  repo: OpenDropRepository;
  storage: ArtifactStorage;
  authConfig: OpenDropAuthConfig;
}

export function registerDeploymentApiRoutes(app: Hono<AppBindings>, { repo, storage, authConfig }: DeploymentRouteOptions) {
  app.get("/api/deployments/:namespace/:slug", async (c) => {
    const params = deploymentRefSchema.safeParse(c.req.param());
    if (!params.success) return validationError(c, params.error);
    const deployment = await repo.getDeploymentVersion(params.data.namespace, params.data.slug);
    if (!deployment) return c.json({ error: "Deployment not found." }, 404);
    const access = await ensureCanView(c, authConfig, deployment.family.visibility);
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
    const access = await ensureCanView(c, authConfig, family.visibility);
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
    const access = await ensureCanView(c, authConfig, deployment.family.visibility);
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
    const access = await ensureCanView(c, authConfig, deployment.family.visibility);
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
    const access = await ensureCanView(c, authConfig, deployment.family.visibility);
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
}

async function ensureCanView(c: OpenDropContext, authConfig: OpenDropAuthConfig, visibility: string): Promise<true | Response> {
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
