import { betterAuth } from "better-auth";
import { z } from "zod";
import { configuredOAuthProviders, oauthProviderSchema, type OAuthProvider } from "@opendrop/shared/auth";

export interface OAuthAccountRef {
  providerId: OAuthProvider;
  accountId: string;
}

export interface BrowserAuth {
  handler(request: Request): Response | Promise<Response>;
  api: {
    getSession(input: { headers: Headers }): Promise<{
      user: {
        id: string;
        email: string;
        emailVerified: boolean;
        name?: string | null;
        image?: string | null;
      };
    } | null>;
  };
  resolveOAuthAccount?(betterAuthUserId: string, providers: OAuthProvider[]): Promise<OAuthAccountRef | null>;
}

const oauthAccountRefSchema = z.object({
  providerId: oauthProviderSchema,
  accountId: z.string().min(1)
});

export function createBrowserAuth(env: Record<string, string | undefined>, database: unknown): BrowserAuth {
  const oauthProviders = configuredOAuthProviders(env);
  const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};
  if (oauthProviders.includes("github")) {
    socialProviders.github = {
      clientId: env.GITHUB_CLIENT_ID!,
      clientSecret: env.GITHUB_CLIENT_SECRET!
    };
  }
  if (oauthProviders.includes("google")) {
    socialProviders.google = {
      clientId: env.GOOGLE_CLIENT_ID!,
      clientSecret: env.GOOGLE_CLIENT_SECRET!
    };
  }

  const auth = betterAuth({
    database: database as any,
    secret: requiredBetterAuthSecret(env.BETTER_AUTH_SECRET),
    baseURL: env.BETTER_AUTH_URL,
    socialProviders
  }) as unknown as BrowserAuth;

  return {
    ...auth,
    resolveOAuthAccount: (betterAuthUserId, providers) => resolveOAuthAccount(database, betterAuthUserId, providers)
  };
}

export function requiredBetterAuthSecret(value: string | undefined): string {
  if (!value || value.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be set to at least 32 characters when OPENDROP_AUTH_MODE=oauth.");
  }
  return value;
}

export async function resolveOAuthAccount(
  database: unknown,
  betterAuthUserId: string,
  providers: OAuthProvider[]
): Promise<OAuthAccountRef | null> {
  for (const provider of providers) {
    const row = await readOAuthAccountRow(database, betterAuthUserId, provider).catch(() => null);
    const parsed = oauthAccountRefSchema.safeParse(row);
    if (parsed.success && parsed.data.providerId === provider) return parsed.data;
  }
  return null;
}

async function readOAuthAccountRow(database: unknown, betterAuthUserId: string, provider: OAuthProvider): Promise<unknown> {
  const sql = 'select "providerId", "accountId" from "account" where "userId" = ? and "providerId" = ? order by "accountId" asc limit 1';
  if (isPostgresKyselyDatabase(database)) {
    return database.db
      .selectFrom("account")
      .select(["providerId", "accountId"])
      .where("userId", "=", betterAuthUserId)
      .where("providerId", "=", provider)
      .orderBy("accountId", "asc")
      .limit(1)
      .executeTakeFirst();
  }
  if (hasPrepare(database)) {
    const statement = database.prepare(sql);
    if (hasGet(statement)) return statement.get(betterAuthUserId, provider);
    if (hasBindFirst(statement)) return statement.bind(betterAuthUserId, provider).first();
  }
  return null;
}

interface OAuthAccountQuery {
  where(column: string, operator: string, value: string): OAuthAccountQuery;
  orderBy(column: string, direction: string): OAuthAccountQuery;
  limit(limit: number): OAuthAccountQuery;
  executeTakeFirst(): Promise<unknown>;
}

function isPostgresKyselyDatabase(value: unknown): value is {
  db: {
    selectFrom(table: string): {
      select(columns: string[]): OAuthAccountQuery;
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
