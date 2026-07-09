import { createBrowserAuth } from "@/auth";
import { createOpenDropApp, registerDeploymentPageRoutes } from "@/app";
import { loadAuthConfig } from "@opendrop/shared/auth/config";
import { createD1Repository } from "@opendrop/shared/db/d1";
import { R2ArtifactStorage } from "@opendrop/shared/storage/r2";

export interface Env {
  DB: D1Database;
  ARTIFACTS: R2Bucket;
  ASSETS: Fetcher;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  OPENDROP_AUTH_MODE?: string;
  OPENDROP_ALLOWED_EMAIL_DOMAINS?: string;
  OPENDROP_DEFAULT_VISIBILITY?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  TRUSTED_PROXY_CIDRS?: string;
  TRUSTED_PROXY_HOSTS?: string;
  TRUSTED_HEADER_EMAIL?: string;
  TRUSTED_HEADER_USER_ID?: string;
  TRUSTED_HEADER_NAME?: string;
  TRUSTED_HEADER_AVATAR?: string;
  TRUSTED_HEADER_LOGIN_URL?: string;
  TRUSTED_HEADER_AUTO_PROVISION?: string;
  TRUSTED_HEADER_ALLOW_EMAIL_LINKING?: string;
  OPENDROP_TRUST_CLOUDFLARE_ACCESS?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const authEnvironment = env as unknown as Record<string, string | undefined>;
    const authConfig = loadAuthConfig(authEnvironment);
    const services = {
      repo: createD1Repository(env.DB as any),
      storage: new R2ArtifactStorage(env.ARTIFACTS as any),
      browserAuth: authConfig.authMode === "oauth" ? createBrowserAuth(authEnvironment, env.DB) : undefined,
      authConfig
    };
    const trustedSourceHost = env.OPENDROP_TRUST_CLOUDFLARE_ACCESS === "true" ? "cloudflare-workers" : undefined;
    const app = createOpenDropApp({ ...services, trustedSourceHost });
    registerDeploymentPageRoutes(app, {
      ...services,
      renderShell: () => env.ASSETS.fetch(indexRequest(request))
    });
    const response = await app.fetch(request);
    if (response.status !== 404 || isApiLikeRequest(request)) return response;
    return env.ASSETS.fetch(request);
  }
};

function indexRequest(request: Request): Request {
  const url = new URL(request.url);
  url.pathname = "/";
  url.search = "";
  return new Request(url, request);
}

function isApiLikeRequest(request: Request): boolean {
  const pathname = new URL(request.url).pathname;
  return pathname.startsWith("/api") || pathname.startsWith("/preview") || pathname.startsWith("/__dev");
}
