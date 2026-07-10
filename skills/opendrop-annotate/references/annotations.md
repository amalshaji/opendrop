# Annotation CLI Reference

Read the current version and page annotations first:

```bash
opendrop annotations amal/homepage --path / --version-id ver_123
```

Add a page-level note. Repeat `--tag` to attach multiple tags:

```bash
opendrop annotation add amal/homepage \
  --body "The hero button wraps on mobile." \
  --path / \
  --version-id ver_123 \
  --tag mobile \
  --tag layout
```

Reply, resolve, or reopen by annotation id:

```bash
opendrop annotation reply amal/homepage ann_123 --body "Fixed in the next version."
opendrop annotation resolve amal/homepage ann_123
opendrop annotation reopen amal/homepage ann_123
```

Version URLs are accepted wherever `amal/homepage` appears. A reply inherits the parent's version, page path, shape, and viewport.

## Page-Level Note Payload

`annotation add` validates and sends this shape. The coordinates and viewport are deterministic; create visual pins and highlights in the browser review room instead.

```json
{
  "pagePath": "/",
  "versionId": "ver_123",
  "body": "The hero button wraps on mobile.",
  "tags": ["mobile", "layout"],
  "shape": { "type": "note", "x": 0.5, "y": 0.5 },
  "viewport": { "width": 1280, "height": 720, "scrollX": 0, "scrollY": 0 }
}
```
