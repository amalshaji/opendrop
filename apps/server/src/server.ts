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
app.get("/favicon.svg", async () => serveWebRootFile("favicon.svg"));
app.get("/opendrop-logo.svg", async () => serveWebRootFile("opendrop-logo.svg"));
app.get("/favicon.ico", async () => {
  return serveWebRootFile("favicon.svg");
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

async function serveWebRootFile(path: string): Promise<Response> {
  if (serverEnv.OPENDROP_WEB_DEV_URL) {
    const devServerUrl = serverEnv.OPENDROP_WEB_DEV_URL.replace(/\/$/, "");
    try {
      const response = await fetch(`${devServerUrl}/${path}`);
      if (!response.ok || !response.body) return new Response("Not found", { status: response.status });
      return new Response(response.body, {
        headers: {
          "content-type": response.headers.get("content-type") ?? contentTypeForPath(path),
          "cache-control": "no-store"
        }
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  }
  return serveBuiltFile(path);
}
