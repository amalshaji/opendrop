# Cloudflare Deployment

Cloudflare V1 is designed around Workers, D1, and R2.

1. Create an R2 bucket and D1 database.
2. Build the web shell with `bun run --cwd apps/web build`.
3. Update `apps/server/wrangler.toml` with the D1 database id, R2 bucket name, and `[assets]` binding.
4. Configure auth:
   - OAuth secrets for Google/GitHub, or
   - Cloudflare Access/trusted headers such as `cf-access-authenticated-user-email`; after Access protects the Worker, set `OPENDROP_AUTH_MODE=trusted-header`, `TRUSTED_HEADER_EMAIL=cf-access-authenticated-user-email`, `TRUSTED_PROXY_HOSTS=cloudflare-workers`, and `OPENDROP_TRUST_CLOUDFLARE_ACCESS=true`.
5. Apply D1 migrations from `packages/shared/migrations`.
6. Deploy with `bun run --cwd apps/server deploy:cloudflare`.

`run_worker_first = true` lets the Worker enforce API, preview, and private-share access before falling back to the static React shell.

Large browser uploads must stay below the Worker request body limit. For larger uploads, add a direct-to-R2 multipart flow before raising server-side caps.
