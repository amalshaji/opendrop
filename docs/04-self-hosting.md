# Self-Hosting

Self-hosted OpenDrop runs the Bun server, SQLite or PostgreSQL metadata storage, and S3-compatible object storage. The default local storage target is MinIO.

## Quick Start

```bash
bun install
docker compose -f docker-compose.dev.yml up --build dev
```

The dev compose stack starts:

- `dev`: OpenDrop server on `http://localhost:3000`
- `minio`: S3-compatible object storage on `http://localhost:9000`
- `createbuckets`: one-shot bucket setup for `opendrop`

## Local Development Without Docker Server

Run MinIO and then start the Bun server plus Vite:

```bash
docker compose up -d minio
bun run dev
```

`bun run dev` starts the server on port `3000` and Vite on `5173`. The server renders a Vite-powered shell in development and the manifest-built shell in production.

## Required Environment

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

## Production Notes

- Set a strong `BETTER_AUTH_SECRET`.
- Put the server behind TLS.
- Use OAuth or trusted-header auth instead of dev auth.
- Persist the SQLite path or PostgreSQL database and object storage bucket.
- Strip identity headers at the reverse proxy before injecting trusted headers.

## PostgreSQL Mode

```bash
OPENDROP_DB_DRIVER=postgres
DATABASE_URL=postgres://opendrop:opendrop@postgres:5432/opendrop
```

The Bun server runs the same OpenDrop repository contract against PostgreSQL. Use `make postgres-test` locally to verify the repository path against Docker Postgres.
