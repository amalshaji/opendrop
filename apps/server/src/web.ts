import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface ManifestChunk {
  file: string;
  css?: string[];
  imports?: string[];
  isEntry?: boolean;
}

type Manifest = Record<string, ManifestChunk>;

export interface WebShellOptions {
  devServerUrl?: string;
  webDist: string;
}

export function renderWebShell({ devServerUrl, webDist }: WebShellOptions): string {
  if (devServerUrl) return renderDevShell(devServerUrl.replace(/\/$/, ""));

  const manifestPath = join(webDist, ".vite/manifest.json");
  if (!existsSync(manifestPath)) {
    return baseHtml("<!-- OpenDrop web bundle has not been built yet. Run `bun run --cwd apps/web build`. -->");
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  const entry = manifest["src/main.tsx"];
  if (!entry) return baseHtml("<!-- Vite manifest entry src/main.tsx was not found. -->");

  const tags: string[] = [];
  for (const chunk of importedChunks(manifest, entry)) {
    tags.push(`<link rel="modulepreload" href="/${chunk.file}" />`);
    for (const css of chunk.css ?? []) tags.push(`<link rel="stylesheet" href="/${css}" />`);
  }
  for (const css of entry.css ?? []) tags.push(`<link rel="stylesheet" href="/${css}" />`);
  tags.push(`<script type="module" src="/${entry.file}"></script>`);
  return baseHtml(tags.join("\n    "));
}

function renderDevShell(devServerUrl: string): string {
  return baseHtml(`<script type="module">
      import RefreshRuntime from '${devServerUrl}/@react-refresh'
      RefreshRuntime.injectIntoGlobalHook(window)
      window.$RefreshReg$ = () => {}
      window.$RefreshSig$ = () => (type) => type
      window.__vite_plugin_react_preamble_installed__ = true
    </script>
    <script type="module" src="${devServerUrl}/@vite/client"></script>
    <script type="module" src="${devServerUrl}/src/main.tsx"></script>`);
}

function importedChunks(manifest: Manifest, entry: ManifestChunk): ManifestChunk[] {
  const seen = new Set<string>();

  function walk(chunk: ManifestChunk): ManifestChunk[] {
    const chunks: ManifestChunk[] = [];
    for (const key of chunk.imports ?? []) {
      const imported = manifest[key];
      if (!imported || seen.has(key)) continue;
      seen.add(key);
      chunks.push(...walk(imported), imported);
    }
    return chunks;
  }

  return walk(entry);
}

function baseHtml(scriptsAndStyles: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="apple-touch-icon" href="/opendrop-logo.svg" />
    <title>OpenDrop</title>
    ${scriptsAndStyles}
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;
}
