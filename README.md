<p align="center">
  <img src="./apps/web/public/opendrop-logo.svg" alt="OpenDrop logo" width="56">
</p>

<p align="center">
  <img src="./docs/public/readme-demo.gif" alt="OpenDrop demo: publish static previews and collect review comments" width="100%">
</p>

# OpenDrop

OpenDrop is an open-source TypeScript app for publishing static HTML drops with validation, versioned URLs, public/private previews, and review annotations.

It accepts a folder or zip, validates the artifact, stores immutable versions, renders the uploaded site from object storage, and keeps review comments attached to the exact version and page.

## CLI Quick Start

Authenticate, upload a static build, then fetch review context:

```bash
npx opendrop login --server https://drops.example.com
npx opendrop upload ./dist --slug homepage
npx opendrop annotations amal/homepage --path /
npx opendrop fetch amal/homepage --include html,annotations --path /
```

The published CLI runs on Node 20+ and does not require Bun on the user's machine. See [CLI basics](docs/01-cli-basics.md) for install, auth, upload, namespace, and annotation commands.

## Docs

Start here:

1. [CLI basics](docs/01-cli-basics.md) - auth, upload, and getting annotations.
2. [How OpenDrop works](docs/02-how-it-works.md) - upload validation, rendering, versions, and visibility.
3. [Authentication](docs/03-authentication.md) - OAuth, trusted headers, users, namespaces, and CLI tokens.
4. [Self-hosting](docs/04-self-hosting.md) - Bun, SQLite/PostgreSQL, and S3-compatible storage.
5. [Cloudflare deployment](docs/05-cloudflare.md) - Workers, D1, R2, assets, and Access headers.
6. [Storage model](docs/06-storage.md) - metadata, artifact objects, and immutable versions.
7. [Annotations](docs/07-annotations.md) - point comments, highlights, replies, and version context.
8. [Agent skills](docs/08-skills.md) - repo-hosted skills for upload and review workflows.
9. [Trusted header auth](docs/09-trusted-headers.md) - reverse proxy requirements and examples.

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

- `apps/server`: Bun-native Hono server, Better Auth integration, self-hosted and Cloudflare entrypoints.
- `apps/web`: React/Vite app for uploads, the full-screen review room, settings, and device login.
- `apps/cli`: Node-compatible CLI published as `opendrop`.
- `packages/shared`: validation, auth helpers, repository interfaces, database adapters, and storage adapters.
- `skills`: repo-hosted skills for upload, annotation, and review-page workflows.
- `docs`: plain Markdown docs linked from this README.
- `tests`: unit, integration, and Playwright E2E coverage.

## Local Development

```bash
bun install
cp .env.example .env
docker compose up -d minio
docker compose up createbuckets
bun run dev
```

`bun run dev` starts the Bun server on `http://localhost:3000` and the Vite React dev server on `http://localhost:5173`.

For clone-and-run Docker development with SQLite plus MinIO:

```bash
docker compose -f docker-compose.dev.yml up --build dev
# or
make dev-docker
```

## Testing

```bash
bun run test
bun run test:skills
bun run test:e2e
```
