---
name: opendrop-upload
description: Upload static folders or zip files to OpenDrop with validation, namespace and slug defaults, visibility selection, and versioned preview URLs. Use when an agent needs to publish local artifacts through the OpenDrop CLI or API and report public/private preview links.
---

# OpenDrop Upload

Use this skill to publish a static site artifact to OpenDrop.

## Workflow

1. Confirm the local path exists and contains a root `index.html` when uploading a folder.
2. Run `opendrop whoami` to learn the server auth mode and default namespace.
3. Upload with `opendrop upload <path>`.
4. Pass `--namespace`, `--slug`, or `--visibility public|private` only when the user requested them.
5. Report both the latest URL and version-specific URL.

## Defaults

- Missing namespace defaults to the authenticated user's stored default namespace.
- Missing slug generates a random slug.
- Missing visibility defaults to the server default, normally `public`.
- Existing namespace/slug creates a new immutable version only when the user has publish access.

## Failure Handling

- If validation fails, show the hard errors first and do not retry with a modified artifact unless the user asks.
- If a file is skipped, say which constraint caused the skip.
- If auth fails, run `opendrop login --server <url>` or ask the user for a CLI token minted from the OpenDrop UI.

See [references/cli.md](references/cli.md) for command examples.
