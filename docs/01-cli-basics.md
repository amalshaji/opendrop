# CLI Basics

The CLI is published as `opendrop` and is bundled for Node 20+. It does not require Bun on the user's machine.

Use this page for the basic loop: authenticate, upload a folder or zip, and fetch annotations for review work.

## Install or Run

```bash
npx opendrop --help
npm install -g opendrop
opendrop --help
```

Use `npx opendrop` for one-off commands, or install globally if you publish often.

## Authenticate

```bash
npx opendrop login --server https://drops.example.com
opendrop whoami
```

`opendrop login` creates a device request, opens the server approval page, polls for approval, and stores the returned token locally.

You can also store server URLs explicitly:

```bash
opendrop config set server-url http://localhost:3000
opendrop config set deployment-url https://drops.example.com
```

`server-url` is used for authentication and API calls. `deployment-url` is optional and controls the absolute preview links printed after upload. If it is not configured, upload output falls back to `server-url`.

## Upload

```bash
opendrop upload ./dist
opendrop upload ./dist --slug homepage --visibility private
opendrop upload ./site.zip --namespace amal --slug qa-review
```

No namespace defaults to the user's default namespace. No slug creates a random slug. Upload output includes a latest URL and a version-specific URL.

Visibility options:

- `public`: anyone with the link can view.
- `private`: the viewer must authenticate to that OpenDrop instance.

## Get Annotations

Fetch page-specific comments and review context:

```bash
opendrop annotations amal/homepage --path /
opendrop annotations amal/homepage --path / --version-id ver_123
opendrop fetch amal/homepage --include html,annotations --path /
opendrop fetch amal/homepage --include html,annotations --version-id ver_123
opendrop versions amal/homepage
```

Use `fetch --include html,annotations` when an agent needs both rendered page HTML and review comments. Use `annotations` when you only need comment state.

Create a page-level note, reply to it, and update its resolved state:

```bash
opendrop annotation add amal/homepage --body "Tighten the hero copy." --path / --version-id ver_123 --tag copy
opendrop annotation reply amal/homepage ann_123 --body "Updated in the next draft."
opendrop annotation resolve amal/homepage ann_123
opendrop annotation reopen amal/homepage ann_123
```

`annotation add` creates a page-level note without synthetic browser coordinates. Use the browser review room to author visual pins and highlights. The server attaches replies to the parent annotation and inherits its version and page context.

## Namespaces

```bash
opendrop namespaces list
opendrop namespaces create launch-team
opendrop namespaces members launch-team
opendrop namespaces add-publisher launch-team teammate@example.com
opendrop namespaces remove-publisher launch-team usr_123
```

Owners can create custom namespaces and grant publish access to existing users. Publishers can create new slugs inside a namespace, but only the original slug owner can publish later versions to that same `namespace/slug`.
