import type { Context } from "hono";
import type { AuthenticatedUser, OpenDropAuthConfig } from "@opendrop/shared/auth";
import type { OpenDropRepository } from "@opendrop/shared/db/repository";
import type { ArtifactStorage } from "@opendrop/shared/storage/interface";
import type { BrowserAuth } from "@/auth";

export interface AppBindings {
  Bindings: {
    incoming?: {
      socket?: {
        remoteAddress?: string;
      };
    };
  };
  Variables: {
    user: AuthenticatedUser | null;
    authError: { message: string; status: number } | null;
  };
}

export interface CreateAppOptions {
  repo: OpenDropRepository;
  storage: ArtifactStorage;
  browserAuth?: BrowserAuth;
  authConfig: OpenDropAuthConfig;
  trustedSourceHost?: string;
  trustedSourceIp?: string | null;
}

export type OpenDropContext = Context<AppBindings>;

export interface DeploymentPageRouteOptions {
  repo: OpenDropRepository;
  storage: ArtifactStorage;
  authConfig: OpenDropAuthConfig;
  renderShell?: (c: OpenDropContext) => Response | Promise<Response>;
}
