# Agent Skills

OpenDrop ships repo-hosted skills for agent workflows. They live in `skills/<skill-name>/SKILL.md` with OpenAI agent metadata under `skills/<skill-name>/agents/openai.yaml`.

## Install

List the skills exposed by this repo:

```bash
npx --yes skills add . --list
```

Install a specific skill from the repo root:

```bash
npx --yes skills add . opendrop-upload
npx --yes skills add . opendrop-review-page
npx --yes skills add . opendrop-annotate
```

## Included Skills

### `opendrop-upload`

Use when an agent needs to publish a local static folder or zip through OpenDrop and report preview URLs.

Default workflow:

1. Confirm the local path exists and contains a root `index.html` when uploading a folder.
2. Run `opendrop whoami` to learn the server auth mode and default namespace.
3. Upload with `opendrop upload <path>`.
4. Pass `--namespace`, `--slug`, or `--visibility public|private` only when requested.
5. Report both the latest URL and version-specific URL.

Reference: [../skills/opendrop-upload/SKILL.md](../skills/opendrop-upload/SKILL.md)

### `opendrop-review-page`

Use when an agent needs to inspect a published OpenDrop page, summarize page content, or gather version-specific annotations.

Default workflow:

1. Identify the target as a URL or `namespace/slug`.
2. Use `opendrop fetch <target> --include html,annotations --path /`.
3. Use `--version-id <versionId>` when the user asks for a fixed version.
4. Summarize only annotations for the requested page or screen.
5. Preserve whether the preview is public or private if the API response includes it.

Reference: [../skills/opendrop-review-page/SKILL.md](../skills/opendrop-review-page/SKILL.md)

### `opendrop-annotate`

Use when an agent needs to create, update, resolve, or summarize OpenDrop annotations.

Default workflow:

1. Fetch current annotations before changing anything.
2. Use version-specific context when the user gives a version URL.
3. Create concise annotation bodies with a clear action or observation.
4. Keep annotations tied to the relevant page path and viewport context.
5. Do not resolve another user's annotation unless explicitly asked.

Reference: [../skills/opendrop-annotate/SKILL.md](../skills/opendrop-annotate/SKILL.md)

## Validation

Run the skills test after editing skill metadata:

```bash
bun run test:skills
```
