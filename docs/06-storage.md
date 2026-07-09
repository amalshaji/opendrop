# Storage Model

OpenDrop splits metadata and artifact bytes.

## Database

The database stores:

- users and identities
- namespaces and publisher access
- deployment families and immutable versions
- file manifests and object keys
- annotations and replies
- CLI device authorizations and token hashes

Self-hosted V1 supports SQLite and PostgreSQL. Cloudflare uses D1. Drizzle defines the database schema for SQLite/D1 and PostgreSQL, while repository interfaces keep the application code shared across runtimes.

## Object Storage

Object storage contains uploaded files. Self-hosted deployments use S3-compatible storage such as MinIO. Cloudflare deployments use R2.

Object keys include namespace, slug, version id, and artifact path so old versions remain immutable.
