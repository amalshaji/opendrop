<p align="center">
  <img src="./docs/public/readme-demo.gif" alt="OpenDrop demo: publish static previews and collect review comments" width="100%">
</p>

# OpenDrop

OpenDrop is an open-source TypeScript app for publishing static HTML drops with validation, versioned URLs, public/private previews, and review annotations.

It accepts a folder or zip, validates the artifact, stores immutable versions, renders the uploaded site from object storage, and keeps review comments attached to the exact version and page.

## Contents

- [What OpenDrop Supports](#what-opendrop-supports)
- [Repository Layout](#repository-layout)
- [Local Development](#local-development)
- [How Uploads Work](#how-uploads-work)
- [Versioning and Preview URLs](#versioning-and-preview-urls)
- [Self-Hosting](#self-hosting)
- [Cloudflare Deployment](#cloudflare-deployment)
- [Authentication](#authentication)
- [CLI](#cli)
- [Annotations](#annotations)
- [Storage Model](#storage-model)
- [Agent-Friendly E2E](#agent-friendly-e2e)

## What OpenDrop Supports

V1 supports:

- self-hosted Bun server with SQLite or PostgreSQL metadata storage
- S3-compatible object storage for self-hosted deployments, with MinIO as the default local target
- Cloudflare deployment with D1 and R2 from the same server app
- browser uploads and the `opendrop` npm CLI
- Better Auth OAuth or trusted-header auth for VPN/reverse-proxy deployments
- public previews and private previews for users authenticated to that OpenDrop instance
- point comments, text highlights, nested replies, and resolved review threads
- repo-hosted agent skills installable with `npx skills add`

## Repository Layout

The V1 repository intentionally stays small:

- `apps/server`: Bun-native Hono server, Better Auth integration, self-hosted and Cloudflare entrypoints.
- `apps/web`: React/Vite app for uploads, the full-screen review room, settings, and device login.
- `apps/cli`: Node-compatible CLI published as `opendrop`.
- `packages/shared`: core validation, auth helpers, repository interfaces, SQLite/D1/PostgreSQL database adapters, and S3/R2 storage adapters.
- `skills`: repo-hosted skills for upload, annotation, and review-page workflows.
- `tests`: unit, integration, and Playwright E2E coverage.

## Local Development

```bash
bun install
cp .env.example .env
docker compose up -d minio
docker compose up createbuckets
bun run dev
```

`bun run dev` starts the Bun server on `http://localhost:3000` and the Vite React dev server on `http://localhost:5173`. The server renders the Vite dev shell in development and the built Vite manifest in production.

For clone-and-run Docker development with SQLite plus MinIO, use:

```bash
docker compose -f docker-compose.dev.yml up --build dev
# or
make dev-docker
```

To use PostgreSQL for self-hosted metadata, set `OPENDROP_DB_DRIVER=postgres` and `DATABASE_URL`:

```bash
OPENDROP_DB_DRIVER=postgres DATABASE_URL=postgres://opendrop:opendrop@localhost:5432/opendrop bun run dev
make postgres-test
```

## How Uploads Work

OpenDrop is a static artifact review system. It does not rebuild your app. It stores the files you upload and renders them through a review shell.

Upload flow:

1. A browser or CLI sends a folder or zip.
2. The server expands zip files and normalizes paths.
3. Validation checks file count, total size, per-file size, text line counts, unsafe paths, duplicate paths, and the root `index.html`.
4. The UI shows accepted files, skipped files, and blocking errors.
5. Publish writes accepted files to object storage and metadata to the database.

Missing root `index.html` is a hard error.

## Versioning and Preview URLs

`/{namespace}/{slug}` resolves to the latest version. `?version={versionId}` pins a specific immutable version.

```text
/{namespace}/{slug}
/{namespace}/{slug}?version={versionId}
```

Namespace owners and publishers can create new slugs inside namespaces they can publish to. After a `namespace/slug` exists, only that slug owner can create later versions. Existing files are never overwritten; the latest pointer moves to the newest version.

Share URLs render the full-screen review room. The review room loads the uploaded site inside a sandboxed iframe and keeps comments, visibility controls, and version switching in floating UI around the preview. Relative assets are served from object storage under the same share URL.

Visibility modes:

- Public: anyone with the link can view.
- Private: the viewer must authenticate to that OpenDrop instance.

Owners can change visibility without creating a new artifact version.

## Self-Hosting

Self-hosted OpenDrop runs the Bun server, SQLite or PostgreSQL metadata storage, and S3-compatible object storage.

Quick start:

```bash
bun install
docker compose -f docker-compose.dev.yml up --build dev
```

The dev compose stack starts:

- `dev`: OpenDrop server on `http://localhost:3000`
- `minio`: S3-compatible object storage on `http://localhost:9000`
- `createbuckets`: one-shot bucket setup for `opendrop`

Local development without the Docker server:

```bash
docker compose up -d minio
docker compose up createbuckets
bun run dev
```

Required environment:

```bash
PORT=3000
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=replace-me-with-at-least-32-random-characters
OPENDROP_AUTH_MODE=dev
OPENDROP_DB_DRIVER=sqlite
SQLITE_PATH=/data/opendrop.sqlite
OPENDROP_STORAGE_DRIVER=s3
S3_ENDPOINT=http://minio:9000
S3_BUCKET=opendrop
S3_ACCESS_KEY_ID=opendrop
S3_SECRET_ACCESS_KEY=opendrop-secret
S3_FORCE_PATH_STYLE=true
```

Production notes:

- Set a strong `BETTER_AUTH_SECRET`.
- Put the server behind TLS.
- Use OAuth or trusted-header auth instead of dev auth.
- Persist the SQLite path or PostgreSQL database and object storage bucket.
- Strip identity headers at the reverse proxy before injecting trusted headers.

PostgreSQL mode:

```bash
OPENDROP_DB_DRIVER=postgres
DATABASE_URL=postgres://opendrop:opendrop@postgres:5432/opendrop
```

## Cloudflare Deployment

The server app includes a Cloudflare entrypoint at `apps/server/src/cloudflare.ts`.

Runtime mapping:

- Database: D1
- Object storage: R2
- HTTP server: Cloudflare Workers runtime
- Web shell: Workers Static Assets from `apps/web/dist`
- Auth: Better Auth plus OAuth or trusted headers

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

Deploy:

```bash
bun run --cwd apps/web build
bun run --cwd apps/server deploy:cloudflare
```

Cloudflare Access can inject `cf-access-authenticated-user-email`. Protect the Worker with Cloudflare Access before relying on these headers, and do not expose a route where clients can send identity headers directly.

After Access protects the Worker, opt in explicitly:

```toml
OPENDROP_AUTH_MODE = "trusted-header"
TRUSTED_HEADER_EMAIL = "cf-access-authenticated-user-email"
TRUSTED_PROXY_HOSTS = "cloudflare-workers"
OPENDROP_TRUST_CLOUDFLARE_ACCESS = "true"
```

## Authentication

OpenDrop uses Better Auth for browser login and OpenDrop-issued tokens for CLI access.

### OAuth

Configure Google or GitHub provider credentials on the server. OAuth identities are provisioned after the provider returns a verified email and the optional allowed-domain checks pass.

When `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` or `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are configured, the web shell exposes matching Better Auth sign-in buttons automatically.

OpenDrop links OAuth users by the Better Auth provider account row, using `providerId:accountId` as the durable identity subject. The email, name, and avatar are refreshed from the verified provider session.

### Trusted Header Auth

Trusted header auth is for deployments behind a VPN, reverse proxy, or access gateway.

The server trusts identity headers only when the request comes from configured proxy CIDRs or a runtime-controlled trusted source host. Admins must strip inbound identity headers before forwarding to OpenDrop and inject fresh trusted headers after authentication.

Self-hosted deployments should use `TRUSTED_PROXY_CIDRS` for the reverse proxy source IP ranges. Cloudflare Workers deployments can use the built-in `cloudflare-workers` trusted host marker only after Cloudflare Access protects the Worker and `OPENDROP_TRUST_CLOUDFLARE_ACCESS=true` is set.

For reverse proxy examples, see [docs/reverse-proxy/trusted-headers.md](docs/reverse-proxy/trusted-headers.md).

### User Creation

On first trusted identity sighting, OpenDrop creates a durable user record and a permanent default namespace from the email local-part:

```text
amal@example.com -> amal
```

Reserved names such as `api`, `admin`, `auth`, `assets`, `default`, `login`, `new`, `settings`, and `www` are blocked. If a namespace is taken, OpenDrop appends a short non-enumerable suffix.

If `TRUSTED_HEADER_AUTO_PROVISION=false`, OpenDrop only authenticates identities that already exist in the identity table. Unknown trusted identities receive an `Account not provisioned.` error until an admin provisions the account.

### Namespace Access

Users can create custom namespaces from Settings or the CLI. Namespace owners can add existing users as publishers.

Publisher access allows a user to create new slugs inside that namespace. After a slug exists, later versions are owner-only for that `namespace/slug`, so another publisher cannot replace someone else's preview.

### CLI Tokens

CLI login uses a device flow. The user approves a device request from the browser session, then OpenDrop stores a hashed CLI token in the database. Users can revoke CLI connections from settings.

## CLI

The CLI package publishes as `opendrop` and is bundled for Node 20+. It does not require Bun on the user's machine.

```bash
npx opendrop login
npx opendrop upload ./dist
npm install -g opendrop
opendrop upload ./dist --visibility private
```

Repo operations use Bun, but the published CLI works without Bun on the user's machine.

Configure server URLs:

```bash
opendrop config set server-url http://localhost:3000
opendrop config set deployment-url https://drops.example.com
```

If a command needs a server URL and none is configured, the CLI prompts and stores it in `~/.opendrop/config.json`.

`server-url` is used for authentication and API calls. `deployment-url` is optional and controls the absolute preview links printed after upload. If it is not configured, upload output falls back to `server-url`.

Login:

```bash
opendrop login
```

Upload:

```bash
opendrop upload ./dist --slug homepage --visibility private
opendrop upload ./site.zip --namespace amal --slug qa-review
```

No namespace defaults to the user's default namespace. No slug creates a random slug.

Namespace commands:

```bash
opendrop namespaces list
opendrop namespaces create launch-team
opendrop namespaces members launch-team
opendrop namespaces add-publisher launch-team teammate@example.com
opendrop namespaces remove-publisher launch-team usr_123
```

Fetch review context:

```bash
opendrop fetch amal/homepage --include html,annotations
opendrop fetch amal/homepage --include html,annotations --version-id ver_123
opendrop annotations amal/homepage --path /
opendrop annotations amal/homepage --path / --version-id ver_123
opendrop versions amal/homepage
```

Agents can use these commands to inspect rendered page HTML and page-specific annotations.

## Annotations

OpenDrop keeps review lightweight. Share URLs open a full-screen review room with floating tools and a comments panel.

Supported annotation types:

- Point comments for a precise location on the page.
- Text highlights for selected copy inside the preview.
- Nested replies on any comment in a thread.
- Resolved state so open feedback stays separate from shipped work.

Annotations are stored against a deployment version and page path. A comment on version 3 does not silently move to version 4. The review room shows version context and lets reviewers switch versions while keeping threads attached to the version they were created on.

Point comments store normalized coordinates plus viewport context. Text highlights store normalized rects and the selected text so the preview can render the mark and keep it aligned as the page scrolls.

The CLI can fetch page content with annotations:

```bash
opendrop fetch amal/homepage --include html,annotations
opendrop annotations amal/homepage --path /
```

## Storage Model

OpenDrop splits metadata and artifact bytes.

The database stores:

- users and identities
- namespaces and publisher access
- deployment families and immutable versions
- file manifests and object keys
- annotations and replies
- CLI device authorizations and token hashes

Self-hosted V1 supports SQLite and PostgreSQL. Cloudflare uses D1. Drizzle defines the database schema for SQLite/D1 and PostgreSQL, while repository interfaces keep the application code shared across runtimes.

Object storage contains uploaded files. Self-hosted deployments use S3-compatible storage such as MinIO. Cloudflare deployments use R2.

Object keys include namespace, slug, version id, and artifact path so old versions remain immutable.

## Agent-Friendly E2E

When `OPENDROP_AUTH_MODE=dev`, the server exposes development-only `/__dev` endpoints for local automation:

- `GET /__dev/preflight` checks the repository and object storage path used by E2E.
- `GET /__dev/log-me-in/:email?returnTo=/` creates an authenticated browser session for that test user.
- `GET /__dev/log-me-out?returnTo=/` clears the local session cookie.

These endpoints are intentionally unavailable outside dev auth mode. Playwright uses them to avoid OAuth/device-login ceremony while still testing authenticated UI and private preview behavior.
