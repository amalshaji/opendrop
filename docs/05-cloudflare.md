# Cloudflare Deployment

Cloudflare V1 is designed around Workers, D1, and R2. The server app includes a Cloudflare entrypoint at `apps/server/src/cloudflare.ts`.

## Runtime Mapping

- Database: D1
- Object storage: R2
- HTTP server: Cloudflare Workers runtime
- Web shell: Workers Static Assets from `apps/web/dist`
- Auth: Better Auth for OAuth, or trusted headers without Better Auth

## Configure Wrangler

Edit `apps/server/wrangler.toml`:

```toml
name = "opendrop"
main = "src/cloudflare.ts"
compatibility_date = "2026-07-08"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "opendrop"
database_id = "replace-with-d1-id"
migrations_dir = "../../packages/shared/migrations"

[[r2_buckets]]
binding = "ARTIFACTS"
bucket_name = "opendrop-artifacts"

[assets]
directory = "../web/dist"
binding = "ASSETS"
not_found_handling = "single-page-application"
run_worker_first = true
```

## Deploy

1. Create an R2 bucket and D1 database.
2. Build the web shell with `bun run --cwd apps/web build`.
3. Update `apps/server/wrangler.toml` with the D1 database id, R2 bucket name, and `[assets]` binding.
4. Configure OAuth secrets or Cloudflare Access/trusted headers. OAuth mode requires `BETTER_AUTH_SECRET` with at least 32 characters; trusted-header mode does not.
5. To enable direct uploads, configure `R2_ACCOUNT_ID` and `R2_BUCKET`, then add R2 S3 API credentials as the `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` Worker secrets.
6. Apply D1 migrations from `packages/shared/migrations`.
7. Deploy with `bun run --cwd apps/server deploy:cloudflare`.

```bash
bun run --cwd apps/web build
bun run --cwd apps/server deploy:cloudflare
```

For OAuth, store credentials as Worker secrets rather than `[vars]` values:

```bash
cd apps/server
bunx wrangler secret put BETTER_AUTH_SECRET
bunx wrangler secret put GITHUB_CLIENT_SECRET
bunx wrangler secret put R2_ACCESS_KEY_ID
bunx wrangler secret put R2_SECRET_ACCESS_KEY
```

Add the non-secret R2 values to `[vars]`:

```toml
R2_ACCOUNT_ID = "replace-with-account-id"
R2_BUCKET = "opendrop-artifacts"
```

The Worker continues to read finalized artifacts through the `ARTIFACTS` binding. The S3 API credentials are used only to sign five-minute exact-key, create-only PUT URLs; they are never returned to clients. Configure R2 CORS for the OpenDrop app origin with method `PUT` and allowed headers `content-type`, `cache-control`, `if-none-match`, and `x-amz-meta-sha256`. Presigned URLs are bearer credentials and must not be logged.

`run_worker_first = true` lets the Worker enforce API, preview, and private-share access before falling back to the static React shell.

## Trusted Header Deployments

Cloudflare Access can inject `cf-access-authenticated-user-email`. Protect the Worker with Cloudflare Access before relying on these headers, and do not expose a route where clients can send identity headers directly.

After Access protects the Worker, opt in explicitly:

```toml
OPENDROP_AUTH_MODE = "trusted-header"
TRUSTED_HEADER_EMAIL = "cf-access-authenticated-user-email"
TRUSTED_PROXY_HOSTS = "cloudflare-workers"
OPENDROP_TRUST_CLOUDFLARE_ACCESS = "true"
```

Browser and CLI publishes use staged direct-to-R2 uploads when the S3 API settings are present, avoiding the Worker request body limit. Legacy multipart publishing remains available when direct signing is not configured. Each file remains capped at 25 MiB; multipart object upload for larger individual files is not implemented.

D1 limits individual rows and strings to 2,000,000 bytes. OpenDrop conservatively caps the serialized direct-upload manifest at 1,000,000 UTF-8 bytes before creating a durable session; clients may use the legacy multipart endpoint for that explicit pre-session response. The normal 20,000-file and 90 MiB artifact limits are unchanged.
