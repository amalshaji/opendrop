# How OpenDrop Works

OpenDrop is a static artifact review system. It does not rebuild your app. It stores the files you upload and renders them through a review shell.

## Upload Flow

1. A browser or CLI sends a folder or zip.
2. The server expands zip files and normalizes paths.
3. Validation checks file count, total size, per-file size, text line counts, unsafe paths, duplicate paths, and the root `index.html`.
4. The UI shows accepted files, skipped files, and blocking errors.
5. Publish writes accepted files to object storage and metadata to the database.

Missing root `index.html` is a hard error.

## Versioning

`/{namespace}/{slug}` resolves to the latest version. `?version={versionId}` pins a specific immutable version.

```text
/{namespace}/{slug}
/{namespace}/{slug}?version={versionId}
```

Namespace owners and publishers can create new slugs inside namespaces they can publish to. After a `namespace/slug` exists, only that slug owner can create later versions. Existing files are never overwritten; the latest pointer moves to the newest version.

## Rendering

Share URLs render the full-screen review room. The review room loads the uploaded site inside a sandboxed iframe and keeps comments, visibility controls, and version switching in floating UI around the preview. Relative assets are served from object storage under the same share URL.

## Visibility

- Public: anyone with the link can view.
- Private: the viewer must authenticate to that OpenDrop instance.

Owners can change visibility without creating a new artifact version.

## Annotations

Annotations are stored per deployment version and page path. Visual annotations include normalized coordinates or highlight rects plus viewport context; page notes have no synthetic geometry. All annotations include body text, author, timestamps, nested replies, and resolved state.
