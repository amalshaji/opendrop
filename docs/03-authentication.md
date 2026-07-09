# Authentication

OpenDrop uses Better Auth only for OAuth browser login. Trusted-header and dev deployments do not initialize Better Auth. CLI access uses OpenDrop-issued tokens in every mode.

## OAuth

Configure Google or GitHub provider credentials on the server. OAuth identities are provisioned after the provider returns a verified email and the optional allowed-domain checks pass.

OAuth mode requires an explicit `BETTER_AUTH_SECRET` containing at least 32 characters. OpenDrop has no fallback secret and does not enable password authentication.

When `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` or `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are configured, the web shell exposes matching Better Auth sign-in buttons automatically.

OpenDrop links OAuth users by the Better Auth provider account row, using `providerId:accountId` as the durable identity subject. The email, name, and avatar are refreshed from the verified provider session.

## Trusted Header Auth

Trusted header auth is for deployments behind a VPN, reverse proxy, or access gateway.

The server trusts identity headers only when the request comes from configured proxy CIDRs or a runtime-controlled trusted source host. Admins must strip inbound identity headers before forwarding to OpenDrop and inject fresh trusted headers after authentication.

Self-hosted deployments should use `TRUSTED_PROXY_CIDRS` for the reverse proxy source IP ranges. Cloudflare Workers deployments can use the built-in `cloudflare-workers` trusted host marker only after Cloudflare Access protects the Worker and `OPENDROP_TRUST_CLOUDFLARE_ACCESS=true` is set.

For reverse proxy examples, see [Trusted header auth](09-trusted-headers.md).

## User Creation

On first trusted identity sighting, OpenDrop creates a durable user record and a permanent default namespace from the email local-part:

```text
amal@example.com -> amal
```

Reserved names such as `api`, `admin`, `auth`, `assets`, `default`, `login`, `new`, `settings`, and `www` are blocked. If a namespace is taken, OpenDrop appends a short non-enumerable suffix.

If `TRUSTED_HEADER_AUTO_PROVISION=false`, OpenDrop only authenticates identities that already exist in the identity table. Unknown trusted identities receive an `Account not provisioned.` error until an admin provisions the account.

## Namespace Access

Users can create custom namespaces from Settings or the CLI. Namespace owners can add existing users as publishers.

Publisher access allows a user to create new slugs inside that namespace. After a slug exists, later versions are owner-only for that `namespace/slug`, so another publisher cannot replace someone else's preview.

## CLI Tokens

CLI login uses a device flow. The user approves a device request from the browser session, then OpenDrop stores a hashed CLI token in the database. Users can revoke CLI connections from settings.
