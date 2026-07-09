import { installOpenDropBridge } from "@/annotation-bridge-client";

export const ANNOTATION_BRIDGE = `<script data-opendrop-bridge>(${installOpenDropBridge.toString()})();</script>`;

export function injectAnnotationBridge(html: string): string {
  if (html.includes("data-opendrop-bridge")) return html;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${ANNOTATION_BRIDGE}</body>`);
  return html + ANNOTATION_BRIDGE;
}

export function rewritePreviewHtml(html: string, previewBasePath: string): string {
  const base = previewBasePath.endsWith("/") ? previewBasePath : `${previewBasePath}/`;
  return html
    .replace(/\b(src|href|poster|action)=(["'])\/(?!\/)([^"']*)\2/gi, (_match, attr: string, quote: string, path: string) => {
      return `${attr}=${quote}${base}${path}${quote}`;
    })
    .replace(/url\(\s*(["']?)\/(?!\/)([^"')]+)\1\s*\)/gi, (_match, quote: string, path: string) => {
      return `url(${quote}${base}${path}${quote})`;
    });
}
