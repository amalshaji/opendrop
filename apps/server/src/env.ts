import { Database } from "bun:sqlite";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { z } from "zod";
import { createBrowserAuth, type BrowserAuth } from "@/auth";
import { loadAuthConfig } from "@opendrop/shared/auth";
import { BunSqliteOpenDropRepository, createPostgresRepository, type OpenDropRepository } from "@opendrop/shared/db";
import { S3ArtifactStorage, type ArtifactStorage } from "@opendrop/shared/storage";

export interface RuntimeServices {
  repo: OpenDropRepository;
  storage: ArtifactStorage;
  browserAuth?: BrowserAuth;
  authConfig: ReturnType<typeof loadAuthConfig>;
}

const runtimeEnvSchema = z.object({
  OPENDROP_DB_DRIVER: z.enum(["sqlite", "postgres"]).optional().default("sqlite"),
  SQLITE_PATH: z.string().min(1).optional().default("./storage/opendrop.sqlite"),
  DATABASE_URL: z.string().url().optional(),
  OPENDROP_STORAGE_DRIVER: z.enum(["s3"]).optional().default("s3"),
  S3_BUCKET: z.string().min(1).optional().default("opendrop"),
  S3_ENDPOINT: z.string().url().optional(),
  S3_PRESIGN_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().min(1).optional().default("us-east-1"),
  S3_ACCESS_KEY_ID: z.string().min(1).optional().default("opendrop"),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional().default("opendrop-secret"),
  S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).optional().default("true")
});

export async function createRuntimeServices(env: Record<string, string | undefined>): Promise<RuntimeServices> {
  const parsedEnv = runtimeEnvSchema.parse(env);
  const authConfig = loadAuthConfig(env);
  const dbDriver = parsedEnv.OPENDROP_DB_DRIVER;
  const sqlitePath = parsedEnv.SQLITE_PATH;
  const databaseUrl = parsedEnv.DATABASE_URL;
  const repo =
    dbDriver === "sqlite"
      ? new BunSqliteOpenDropRepository(sqlitePath)
      : dbDriver === "postgres"
        ? createPostgresRepository(requiredDatabaseUrl(databaseUrl))
        : unsupportedDatabaseDriver(dbDriver);
  await repo.migrate();
  const browserAuth =
    authConfig.authMode === "oauth"
      ? createBrowserAuth(env, createBrowserAuthDatabase(dbDriver, sqlitePath, databaseUrl))
      : undefined;

  const storage = new S3ArtifactStorage({
    bucket: parsedEnv.S3_BUCKET,
    endpoint: parsedEnv.S3_ENDPOINT,
    presignEndpoint: parsedEnv.S3_PRESIGN_ENDPOINT,
    region: parsedEnv.S3_REGION,
    accessKeyId: parsedEnv.S3_ACCESS_KEY_ID,
    secretAccessKey: parsedEnv.S3_SECRET_ACCESS_KEY,
    forcePathStyle: parsedEnv.S3_FORCE_PATH_STYLE !== "false"
  });

  return { repo, storage, browserAuth, authConfig };
}

function requiredDatabaseUrl(databaseUrl: string | undefined): string {
  if (!databaseUrl) throw new Error("DATABASE_URL is required when OPENDROP_DB_DRIVER=postgres.");
  return databaseUrl;
}

function unsupportedDatabaseDriver(driver: string): never {
  throw new Error(`Unsupported database driver: ${driver}`);
}

function createBrowserAuthDatabase(dbDriver: string, sqlitePath: string, databaseUrl: string | undefined): unknown {
  if (dbDriver === "postgres") {
    const pool = new Pool({ connectionString: requiredDatabaseUrl(databaseUrl) });
    return {
      db: new Kysely({ dialect: new PostgresDialect({ pool }) }),
      type: "postgres"
    };
  }
  return new Database(sqlitePath);
}
