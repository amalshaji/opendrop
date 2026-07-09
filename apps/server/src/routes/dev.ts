import type { Hono } from "hono";
import {
  createSessionForUser,
  emailAllowed,
  normalizeEmail,
  sessionCookie,
  type OpenDropAuthConfig
} from "@opendrop/shared/auth";
import {
  devLoginBodySchema,
  devLoginParamsSchema,
  randomId,
  safeReturnQuerySchema
} from "@opendrop/shared/core";
import type { OpenDropRepository } from "@opendrop/shared/db/repository";
import type { ArtifactStorage } from "@opendrop/shared/storage/interface";
import type { AppBindings } from "@/app-types";
import {
  errorMessage,
  jsonObject,
  queryObject,
  requireDevMode,
  safeReturnTo,
  validationError,
  wantsJson
} from "@/http-helpers";

interface DevRouteOptions {
  repo: OpenDropRepository;
  storage: ArtifactStorage;
  authConfig: OpenDropAuthConfig;
}

export function registerDevRoutes(app: Hono<AppBindings>, { repo, storage, authConfig }: DevRouteOptions) {
  app.get("/__dev", (c) => {
    const dev = requireDevMode(c, authConfig);
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
    const dev = requireDevMode(c, authConfig);
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
    const dev = requireDevMode(c, authConfig);
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
    const dev = requireDevMode(c, authConfig);
    if (dev instanceof Response) return dev;
    const query = safeReturnQuerySchema.safeParse(queryObject(c.req.url));
    if (!query.success) return validationError(c, query.error);
    c.header("Set-Cookie", sessionCookie("", 0));
    if (wantsJson(c.req.raw)) return c.json({ ok: true });
    return c.redirect(safeReturnTo(query.data.returnTo));
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
}
