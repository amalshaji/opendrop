# Annotations

OpenDrop keeps review lightweight. Share URLs open a full-screen review room with floating tools and a comments panel.

## Supported Annotation Types

- Point comments for a precise location on the page.
- Text highlights for selected copy inside the preview.
- Nested replies on any comment in a thread.
- Resolved state so open feedback stays separate from shipped work.

## Version Awareness

Annotations are stored against a deployment version and page path. A comment on version 3 does not silently move to version 4. The review room shows version context and lets reviewers switch versions while keeping threads attached to the version they were created on.

## Coordinate Model

Point comments store normalized coordinates plus viewport context. Text highlights store normalized rects and the selected text so the preview can render the mark and keep it aligned as the page scrolls.

## CLI Access

The CLI can fetch page content and existing annotations:

```bash
opendrop fetch amal/homepage --include html,annotations
opendrop annotations amal/homepage --path /
```

This lets an agent reason over only the comments relevant to the current page, not the entire project.

Authenticated agents can also create page-level notes, reply to existing annotations, and update resolved state:

```bash
opendrop annotation add amal/homepage --body "The CTA label is unclear." --path / --version-id ver_123 --tag copy --tag priority
opendrop annotation reply amal/homepage ann_123 --body "Suggested replacement: Start free."
opendrop annotation resolve amal/homepage ann_123
opendrop annotation reopen amal/homepage ann_123
```

A version URL can replace `amal/homepage`, for example `https://drops.example.com/amal/homepage/versions/ver_123`. `annotation add` creates a page-level note at normalized coordinates `0.5, 0.5` with a deterministic 1280 x 720 viewport. Visual pins and text highlights remain browser-authored. `annotation reply` fetches the parent and inherits its version, page path, shape, and viewport.

## Payload Shape

```json
{
  "pagePath": "/",
  "versionId": "ver_123",
  "body": "The hero button wraps on mobile.",
  "tags": ["mobile", "layout"],
  "shape": { "type": "pin", "x": 0.52, "y": 0.34 },
  "viewport": { "width": 390, "height": 844, "scrollX": 0, "scrollY": 0 }
}
```
