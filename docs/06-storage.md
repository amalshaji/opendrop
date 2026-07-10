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
- durable 15-minute upload sessions and their validated manifests

Self-hosted V1 supports SQLite and PostgreSQL. Cloudflare uses D1. Drizzle defines the database schema for SQLite/D1 and PostgreSQL, while repository interfaces keep the application code shared across runtimes.

## Object Storage

Object storage contains uploaded files. Self-hosted deployments use S3-compatible storage such as MinIO. Cloudflare deployments use R2.

Object keys include namespace, slug, version id, and artifact path so old versions remain immutable.

## Staged Direct Uploads

The browser and CLI first send a bounded manifest to OpenDrop. OpenDrop allocates the final version id, persists a pending session with a 15-minute upload window, and returns short-lived presigned PUT URLs only for recorded paths. Clients send the exact returned headers and upload at most four files concurrently. An atomic finalization claim renews expiry to a separate 60-minute finalization lease so the original upload deadline cannot invalidate an active verifier.

Finalization does not trust client sizes, hashes, line counts, or object metadata. OpenDrop atomically claims a pending session, then reads and hashes one stored object at a time, verifies its size and content type, and recomputes text line counts before creating the immutable database version. Concurrent finalizers receive an in-progress conflict and cannot verify or clean up the claimant's objects. This bounds server verification memory to the existing 25 MiB per-file limit rather than the 90 MiB total upload limit. The same byte rehash is used for S3 and R2, including when R2 cannot provide a trustworthy full-object checksum.

Successful finalization is idempotent and returns the stored publish result. Missing or tampered objects fail the session and delete its version prefix. Expired-session lifecycle cleanup is intentionally separate from request-time cleanup.
