# Cloudflare Deployment

Cloudflare V1 is designed around Workers, D1, and R2. The server app includes a Cloudflare entrypoint at `apps/server/src/cloudflare.ts`.

## Runtime Mapping

- Database: D1
- Object storage: R2
- HTTP server: Cloudflare Workers runtime
- Web shell: Workers Static Assets from `apps/web/dist`
- Auth: Better Auth plus OAuth or trusted headers

## Configure Wrangler

Edit `apps/server/wrangler.toml`:

```toml
name = "opendrop"
main = "src/cloudflare.ts"
compatibility_date = "2026-07-08"

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
4. Configure OAuth secrets or Cloudflare Access/trusted headers.
5. Apply D1 migrations from `packages/shared/migrations`.
6. Deploy with `bun run --cwd apps/server deploy:cloudflare`.

```bash
bun run --cwd apps/web build
bun run --cwd apps/server deploy:cloudflare
```

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

Large browser uploads must stay below the Worker request body limit. For larger uploads, add a direct-to-R2 multipart flow before raising server-side caps.
