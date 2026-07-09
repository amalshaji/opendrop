---
name: opendrop-review-page
description: Fetch and summarize OpenDrop preview page content with version-specific annotations, comments, and tags. Use when an agent is asked to inspect a published OpenDrop page, respond to review comments, or gather current-screen context.
---

# OpenDrop Review Page

Use this skill to retrieve a rendered page's source context and review annotations.

## Workflow

1. Identify the target as a URL or `namespace/slug`.
2. Use `opendrop fetch <target> --include html,annotations --path /`.
3. Use `--version-id <versionId>` when the user asks for a fixed version instead of latest.
4. Summarize only the annotations for the requested page/screen.
5. Preserve whether the preview is public or private if the API response includes it.

## Review Behavior

- Treat annotations as user feedback.
- Do not modify remote annotations unless the user asks.
- If private access fails, ask the user to authenticate with `opendrop login`.

See [references/fetch.md](references/fetch.md) for examples.
