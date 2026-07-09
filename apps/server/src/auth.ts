import { betterAuth } from "better-auth";
import { z } from "zod";
import { configuredOAuthProviders } from "@opendrop/shared/auth";

export interface OAuthAccountRef {
  providerId: string;
  accountId: string;
}

export interface BrowserAuth {
  handler(request: Request): Response | Promise<Response>;
  api: {
    getSession(input: { headers: Headers }): Promise<{
      user: {
        id: string;
        email: string;
        name?: string | null;
        image?: string | null;
      };
    } | null>;
  };
  resolveOAuthAccount?(betterAuthUserId: string): Promise<OAuthAccountRef | null>;
}

const oauthAccountRefSchema = z.object({
  providerId: z.string().min(1),
  accountId: z.string().min(1)
});

export function createBrowserAuth(env: Record<string, string | undefined>, database: unknown): BrowserAuth {
  const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};
  if (configuredOAuthProviders(env).includes("github")) {
    socialProviders.github = {
      clientId: env.GITHUB_CLIENT_ID!,
      clientSecret: env.GITHUB_CLIENT_SECRET!
    };
  }
  if (configuredOAuthProviders(env).includes("google")) {
    socialProviders.google = {
      clientId: env.GOOGLE_CLIENT_ID!,
      clientSecret: env.GOOGLE_CLIENT_SECRET!
    };
  }

  const auth = betterAuth({
    database: database as any,
    secret: env.BETTER_AUTH_SECRET || "opendrop-dev-secret-change-this-before-production",
    baseURL: env.BETTER_AUTH_URL,
    emailAndPassword: {
      enabled: env.OPENDROP_AUTH_MODE === "dev" || env.OPENDROP_ENABLE_PASSWORD_AUTH === "true"
    },
    socialProviders
  }) as unknown as BrowserAuth;

  return {
    ...auth,
    resolveOAuthAccount: (betterAuthUserId) => resolveOAuthAccount(database, betterAuthUserId)
  };
}

async function resolveOAuthAccount(database: unknown, betterAuthUserId: string): Promise<OAuthAccountRef | null> {
  const row = await readOAuthAccountRow(database, betterAuthUserId).catch(() => null);
  const parsed = oauthAccountRefSchema.safeParse(row);
  return parsed.success ? parsed.data : null;
}

async function readOAuthAccountRow(database: unknown, betterAuthUserId: string): Promise<unknown> {
  const sql = 'select "providerId", "accountId" from "account" where "userId" = ? order by "updatedAt" desc limit 1';
  if (isPostgresKyselyDatabase(database)) {
    return database.db
      .selectFrom("account")
      .select(["providerId", "accountId"])
      .where("userId", "=", betterAuthUserId)
      .orderBy("updatedAt", "desc")
      .limit(1)
      .executeTakeFirst();
  }
  if (hasPrepare(database)) {
    const statement = database.prepare(sql);
    if (hasGet(statement)) return statement.get(betterAuthUserId);
    if (hasBindFirst(statement)) return statement.bind(betterAuthUserId).first();
  }
  return null;
}

function isPostgresKyselyDatabase(value: unknown): value is {
  db: {
    selectFrom(table: string): {
      select(columns: string[]): {
        where(column: string, operator: string, value: string): {
          orderBy(column: string, direction: string): {
            limit(limit: number): {
              executeTakeFirst(): Promise<unknown>;
            };
          };
        };
      };
    };
  };
} {
  return typeof value === "object" && value !== null && "db" in value && typeof (value as { db?: unknown }).db === "object";
}

function hasPrepare(value: unknown): value is { prepare(query: string): unknown } {
  return typeof value === "object" && value !== null && typeof (value as { prepare?: unknown }).prepare === "function";
}

function hasGet(value: unknown): value is { get(...params: unknown[]): unknown } {
  return typeof value === "object" && value !== null && typeof (value as { get?: unknown }).get === "function";
}

function hasBindFirst(value: unknown): value is { bind(...params: unknown[]): { first(): Promise<unknown> } } {
  return typeof value === "object" && value !== null && typeof (value as { bind?: unknown }).bind === "function";
}
