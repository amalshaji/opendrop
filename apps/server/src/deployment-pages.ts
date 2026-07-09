import { Hono } from "hono";
import { artifactRoutePathSchema, deploymentRefSchema, pagePathToArtifactPath, versionedDeploymentRefSchema } from "@opendrop/shared/core";
import type { OpenDropAuthConfig } from "@opendrop/shared/auth";
import type { OpenDropRepository } from "@opendrop/shared/db/repository";
import type { ArtifactStorage } from "@opendrop/shared/storage/interface";
import { artifactBody, artifactResponseHeaders } from "@/artifact-http";
import type { AppBindings, DeploymentPageRouteOptions, OpenDropContext } from "@/app-types";

export function registerDeploymentPageRoutes(app: Hono<AppBindings>, { repo, storage, authConfig, renderShell }: DeploymentPageRouteOptions) {
  app.get("/:namespace/:slug/versions/:versionId", (c) => {
    const params = versionedDeploymentRefSchema.safeParse(c.req.param());
    if (!params.success) return c.notFound();
    const { namespace, slug, versionId } = params.data;
    if (renderShell) return c.redirect(`/${namespace}/${slug}/?version=${encodeURIComponent(versionId)}`, 308);
    return c.redirect(`/${namespace}/${slug}/versions/${versionId}/`, 308);
  });

  app.get("/:namespace/:slug/versions/:versionId/", (c) => {
    const params = versionedDeploymentRefSchema.safeParse(c.req.param());
    if (!params.success) return c.notFound();
    const { namespace, slug, versionId } = params.data;
    if (renderShell) return c.redirect(`/${namespace}/${slug}/?version=${encodeURIComponent(versionId)}`, 308);
    return serveDeploymentPageObject(c, repo, storage, authConfig, namespace, slug, versionId, "index.html");
  });

  app.get("/:namespace/:slug/versions/:versionId/*", (c) => {
    const params = versionedDeploymentRefSchema.safeParse(c.req.param());
    const requestedPath = params.success
      ? pathAfterPrefix(c.req.url, `/${params.data.namespace}/${params.data.slug}/versions/${params.data.versionId}/`)
      : "index.html";
    const path = artifactRoutePathSchema.safeParse(requestedPath);
    if (!params.success || !path.success) return c.notFound();
    return serveDeploymentPageObject(c, repo, storage, authConfig, params.data.namespace, params.data.slug, params.data.versionId, path.data);
  });

  app.get("/:namespace/:slug", (c) => {
    const params = deploymentRefSchema.safeParse(c.req.param());
    if (!params.success) return c.notFound();
    const { namespace, slug } = params.data;
    return c.redirect(`/${namespace}/${slug}/${new URL(c.req.url).search}`, 308);
  });

  app.get("/:namespace/:slug/", (c) => {
    const params = deploymentRefSchema.safeParse(c.req.param());
    if (!params.success) return c.notFound();
    const versionId = versionFromQuery(c.req.url);
    if (renderShell) {
      return serveDeploymentShell(c, repo, authConfig, renderShell, params.data.namespace, params.data.slug, versionId);
    }
    return serveDeploymentPageObject(c, repo, storage, authConfig, params.data.namespace, params.data.slug, versionId, "index.html");
  });

  app.get("/:namespace/:slug/*", (c) => {
    const params = deploymentRefSchema.safeParse(c.req.param());
    const requestedPath = params.success ? pathAfterPrefix(c.req.url, `/${params.data.namespace}/${params.data.slug}/`) : "index.html";
    const path = artifactRoutePathSchema.safeParse(requestedPath);
    if (!params.success || !path.success) return c.notFound();
    return serveDeploymentPageObject(c, repo, storage, authConfig, params.data.namespace, params.data.slug, undefined, path.data);
  });
}

function versionFromQuery(url: string): string | undefined {
  const value = new URL(url).searchParams.get("version");
  return value && value.length > 0 ? value : undefined;
}

function pathAfterPrefix(url: string, prefix: string): string {
  const pathname = new URL(url).pathname;
  if (!pathname.startsWith(prefix)) return "index.html";
  const suffix = pathname.slice(prefix.length);
  return suffix || "index.html";
}

async function serveDeploymentPageObject(
  c: OpenDropContext,
  repo: OpenDropRepository,
  storage: ArtifactStorage,
  authConfig: OpenDropAuthConfig,
  namespace: string,
  slug: string,
  versionId: string | undefined,
  requestedPath: string
): Promise<Response> {
  const deployment = await repo.getDeploymentVersion(namespace, slug, versionId);
  if (!deployment) return c.notFound();
  const access = ensureDeploymentCanView(c, authConfig, deployment.family.visibility);
  if (access instanceof Response) return access;
  const artifactPath = pagePathToArtifactPath(requestedPath);
  const file = await repo.getDeploymentFile(deployment.version.id, artifactPath);
  if (!file) return c.notFound();
  const object = await storage.getObject(file.storageKey);
  if (!object) return c.notFound();
  return new Response(artifactBody(object.body), {
    headers: artifactResponseHeaders(
      object.contentType,
      versionId ? "public, max-age=31536000, immutable" : "public, max-age=60"
    )
  });
}

async function serveDeploymentShell(
  c: OpenDropContext,
  repo: OpenDropRepository,
  authConfig: OpenDropAuthConfig,
  renderShell: (c: OpenDropContext) => Response | Promise<Response>,
  namespace: string,
  slug: string,
  versionId: string | undefined
): Promise<Response> {
  const deployment = await repo.getDeploymentVersion(namespace, slug, versionId);
  if (!deployment) {
    const shell = await renderShell(c);
    return new Response(shell.body, { status: 404, headers: shell.headers });
  }
  const access = ensureDeploymentCanView(c, authConfig, deployment.family.visibility);
  if (access instanceof Response) return access;
  return renderShell(c);
}

function ensureDeploymentCanView(c: OpenDropContext, authConfig: OpenDropAuthConfig, visibility: string): true | Response {
  if (visibility === "public") return true;
  if (c.get("user")) return true;
  const loginUrl = authConfig.trustedHeader?.loginUrl;
  if (loginUrl && c.req.header("accept")?.includes("text/html")) {
    return c.redirect(loginUrl);
  }
  return c.json({ error: "Authentication required for private preview." }, 401);
}
