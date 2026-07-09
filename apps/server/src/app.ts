import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  AuthRejectedError,
  authenticateRequest,
  emailAllowed,
  normalizeEmail,
  type AuthenticatedUser,
  type OpenDropAuthConfig
} from "@opendrop/shared/auth";
import type { OpenDropRepository } from "@opendrop/shared/db/repository";
import type { BrowserAuth } from "@/auth";
import type { AppBindings, CreateAppOptions } from "@/app-types";
import { contentfulStatus, sourceFromContext } from "@/http-helpers";
import { registerCliRoutes } from "@/routes/cli";
import { registerDeploymentApiRoutes } from "@/routes/deployments";
import { registerDevRoutes } from "@/routes/dev";
import { registerDeviceRoutes } from "@/routes/device";
import { registerNamespaceRoutes } from "@/routes/namespaces";
import { registerUploadRoutes } from "@/routes/uploads";

export { registerDeploymentPageRoutes } from "@/deployment-pages";

export function createOpenDropApp({ repo, storage, browserAuth, authConfig, trustedSourceHost, trustedSourceIp }: CreateAppOptions) {
  const app = new Hono<AppBindings>();

  app.use("*", cors({ origin: "*", credentials: true }));
  app.on(["GET", "POST"], "/api/auth/*", (c) => browserAuth.handler(c.req.raw));
  app.use("*", async (c, next) => {
    let user: AuthenticatedUser | null = null;
    const authError: { message: string; status: number } | null = null;
    try {
      user =
        (await authenticateRequest(c.req.raw, sourceFromContext(c, trustedSourceHost, trustedSourceIp), repo, authConfig)) ??
        (await authenticateBetterAuthSession(c.req.raw, repo, browserAuth, authConfig));
    } catch (error) {
      if (error instanceof AuthRejectedError) {
        return c.json({ error: error.message }, contentfulStatus(error.status));
      }
      throw error;
    }
    c.set("user", user);
    c.set("authError", authError);
    await next();
  });

  app.get("/healthz", (c) => c.json({ ok: true }));
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

  registerDevRoutes(app, { repo, storage, authConfig });
  registerCliRoutes(app, { repo });
  registerNamespaceRoutes(app, { repo });
  registerDeviceRoutes(app, { repo });
  registerUploadRoutes(app, { repo, storage, authConfig });
  registerDeploymentApiRoutes(app, { repo, storage, authConfig });

  return app;
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
