import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { createOpenDropApp, registerDeploymentPageRoutes } from "@/app";
import { createRuntimeServices } from "@/env";
import { renderWebShell } from "@/web";
import { contentTypeForPath } from "@opendrop/shared/core";
import { z } from "zod";

const serverEnvSchema = z.object({
  PORT: z.coerce.number().int().positive().max(65535).optional().default(3000),
  SQLITE_PATH: z.string().min(1).optional().default("./storage/opendrop.sqlite"),
  OPENDROP_WEB_DIST: z.string().min(1).optional().default("./apps/web/dist"),
  OPENDROP_WEB_DEV_URL: z.string().url().optional()
});
const builtFileRoutePathSchema = z.string().max(2048).default("");

const serverEnv = serverEnvSchema.parse(process.env);
const sqlitePath = serverEnv.SQLITE_PATH;
mkdirSync(dirname(sqlitePath), { recursive: true });

const services = await createRuntimeServices(process.env);
const app = createOpenDropApp(services);
const port = serverEnv.PORT;
const webDist = serverEnv.OPENDROP_WEB_DIST;

app.get("/assets/:path{.+}", async (c) => {
  const path = builtFileRoutePathSchema.safeParse(c.req.param("path") ?? "");
  if (!path.success) return c.notFound();
  return serveBuiltFile(path.data, "assets");
});
app.get("/favicon.ico", async () => {
  const response = await serveBuiltFile("favicon.ico");
  return response.status === 404 ? new Response(null, { status: 204 }) : response;
});
registerDeploymentPageRoutes(app, {
  ...services,
  renderShell: (c) =>
    c.html(
      renderWebShell({
        devServerUrl: serverEnv.OPENDROP_WEB_DEV_URL,
        webDist
      })
    )
});
app.get("*", (c) => {
  if (!c.req.header("accept")?.includes("text/html")) return c.notFound();
  return c.html(
    renderWebShell({
      devServerUrl: serverEnv.OPENDROP_WEB_DEV_URL,
      webDist
    })
  );
});

Bun.serve({ fetch: app.fetch, port });
console.log(`OpenDrop listening on http://localhost:${port}`);

async function serveBuiltFile(path: string, prefix?: string): Promise<Response> {
  const safePath = normalize(path).replace(/^(\.\.(\/|\\|$))+/, "");
  if (!safePath || isAbsolute(safePath) || safePath.startsWith("..")) return new Response("Not found", { status: 404 });
  const filePath = prefix ? join(webDist, prefix, safePath) : join(webDist, safePath);
  const file = Bun.file(filePath);
  if (!(await file.exists())) return new Response("Not found", { status: 404 });
  return new Response(file, {
    headers: {
      "content-type": contentTypeForPath(filePath),
      "cache-control": "public, max-age=31536000, immutable"
    }
  });
}
