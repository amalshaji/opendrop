import type { Hono } from "hono";
import { cliConnectionParamsSchema, cliTokenBodySchema } from "@opendrop/shared/core";
import type { OpenDropRepository } from "@opendrop/shared/db/repository";
import { createRawCliToken, hashToken } from "@opendrop/shared/db/tokens";
import type { AppBindings } from "@/app-types";
import { jsonObject, requireAuth, validationError } from "@/http-helpers";

interface CliRouteOptions {
  repo: OpenDropRepository;
}

export function registerCliRoutes(app: Hono<AppBindings>, { repo }: CliRouteOptions) {
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
}
