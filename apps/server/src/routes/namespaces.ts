import type { Hono } from "hono";
import {
  namespaceCreateBodySchema,
  namespacePublisherBodySchema,
  namespacePublisherRouteParamsSchema,
  namespaceRouteParamsSchema
} from "@opendrop/shared/core";
import type { OpenDropRepository } from "@opendrop/shared/db/repository";
import type { AppBindings } from "@/app-types";
import { jsonObject, repositoryMutationError, requireAuth, validationError } from "@/http-helpers";

interface NamespaceRouteOptions {
  repo: OpenDropRepository;
}

export function registerNamespaceRoutes(app: Hono<AppBindings>, { repo }: NamespaceRouteOptions) {
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
}
