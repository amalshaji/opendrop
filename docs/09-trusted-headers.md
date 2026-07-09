# Trusted Header Auth

Trusted header auth is for private-network deployments where a VPN, reverse proxy, or access gateway authenticates users before traffic reaches OpenDrop.

OpenDrop does not implement OpenConnect directly. The proxy authenticates the user, strips any inbound identity headers from the client, and injects trusted identity headers before forwarding.

## Required Configuration

- `TRUSTED_PROXY_CIDRS`: proxy source IP ranges OpenDrop may trust
- `TRUSTED_PROXY_HOSTS`: runtime-controlled source host markers OpenDrop may trust, such as `cloudflare-workers`
- `TRUSTED_HEADER_EMAIL`: header containing the authenticated email
- optional `TRUSTED_HEADER_USER_ID`, `TRUSTED_HEADER_NAME`, `TRUSTED_HEADER_AVATAR`
- optional `OPENDROP_ALLOWED_EMAIL_DOMAINS`
- optional `TRUSTED_HEADER_AUTO_PROVISION=false` to require pre-provisioned accounts

## Security Requirements

- Reject direct public access to OpenDrop when trusted-header auth is enabled.
- Strip all inbound identity headers from clients.
- Re-add identity headers only after successful VPN/proxy authentication.
- Keep `TRUSTED_PROXY_CIDRS` narrow.
- When auto-provisioning is disabled, expect unknown trusted identities to receive `Account not provisioned.` until an admin creates them.

## Nginx Sketch

```nginx
proxy_set_header X-OpenDrop-Email "";
proxy_set_header X-OpenDrop-User-Id "";
proxy_set_header X-OpenDrop-Name "";

proxy_set_header X-OpenDrop-Email $authenticated_email;
proxy_set_header X-OpenDrop-User-Id $authenticated_user_id;
proxy_set_header X-OpenDrop-Name $authenticated_name;
proxy_pass http://opendrop:3000;
```
