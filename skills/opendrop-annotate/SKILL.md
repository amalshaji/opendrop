---
name: opendrop-annotate
description: Create, update, resolve, or summarize OpenDrop annotations on versioned static previews. Use when an agent needs to add review notes, mark comments resolved, or explain annotation state for an OpenDrop deployment.
---

# OpenDrop Annotate

Use this skill when the user wants annotation work on an OpenDrop preview.

## Workflow

1. Fetch current annotations before changing anything.
2. Use version-specific context when the user gives a version URL.
3. Create concise annotation bodies with a clear action or observation.
4. Keep annotations tied to the relevant page path and viewport context.
5. Do not resolve another user's annotation unless the user explicitly asks.

## Supported Annotation Types

- `pin`: point note
- `region`: rectangular area
- `freehand`: drawn path
- `note`: text note

See [references/annotations.md](references/annotations.md) for payload examples.
