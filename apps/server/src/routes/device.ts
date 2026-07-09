import type { Hono } from "hono";
import {
  deviceCodeBodySchema,
  deviceDecisionBodySchema,
  deviceRequestParamsSchema,
  deviceTokenBodySchema
} from "@opendrop/shared/core";
import type { OpenDropRepository } from "@opendrop/shared/db/repository";
import { createRawCliToken, createRawDeviceCode, createUserCode, hashToken } from "@opendrop/shared/db/tokens";
import type { AppBindings } from "@/app-types";
import { jsonObject, requireAuth, validationError } from "@/http-helpers";

interface DeviceRouteOptions {
  repo: OpenDropRepository;
}

export function registerDeviceRoutes(app: Hono<AppBindings>, { repo }: DeviceRouteOptions) {
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
}
