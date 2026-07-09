import { ArrowRight, Boxes, GitBranch, LockKeyhole, MessageSquareText, Terminal, UploadCloud } from "lucide-react";
import Link from "next/link";

const features = [
  {
    icon: UploadCloud,
    title: "Drop a folder or zip",
    body: "Upload a static build from the dashboard or CLI. The server validates paths, size limits, and root index.html before publish."
  },
  {
    icon: GitBranch,
    title: "Immutable versions",
    body: "Every publish creates a timestamped version. Latest stays clean, older versions remain shareable, and owners can restore."
  },
  {
    icon: LockKeyhole,
    title: "Public or private previews",
    body: "Public links are reviewable by anyone. Private previews require login on that OpenDrop instance."
  },
  {
    icon: MessageSquareText,
    title: "Full-screen review room",
    body: "Share URLs open a focused preview with floating tools for point comments, text highlights, nested replies, and resolved threads."
  },
  {
    icon: Terminal,
    title: "CLI for agents and CI",
    body: "Publish with npx opendrop from CI or local machines, then fetch page HTML and annotations for automated review loops."
  },
  {
    icon: Boxes,
    title: "Self-hosted or Cloudflare",
    body: "Run Bun + SQLite + MinIO yourself, or deploy the same server app to Cloudflare with D1 and R2."
  }
];

const docs = [
  ["Self-hosting", "Run OpenDrop locally or in Docker with SQLite and MinIO.", "/docs/self-hosting"],
  ["How OpenDrop Works", "Understand upload validation, storage, rendering, versions, visibility, and comments.", "/docs/how-it-works"],
  ["Cloudflare", "Deploy the server app with D1 and R2 bindings.", "/docs/cloudflare"],
  ["Authentication", "Use Better Auth OAuth or trusted headers behind a VPN/proxy.", "/docs/authentication"],
  ["CLI", "Configure server URLs, device login, upload, fetch pages, and read annotations.", "/docs/cli"],
  ["Annotations", "Point comments, text highlights, nested replies, and resolved state.", "/docs/annotations"]
];

export default function Home() {
  return (
    <main className="siteShell">
      <nav className="nav">
        <Link className="docsBrand" href="/">
          <span className="docsBrandMark"><img src="/opendrop-logo.svg" alt="" /></span>
          OpenDrop
        </Link>
        <div className="navLinks">
          <Link href="/docs">Docs</Link>
          <Link href="/docs/self-hosting">Self-host</Link>
          <Link className="primary" href="/docs/cli">
            CLI
          </Link>
        </div>
      </nav>

      <section className="hero">
        <div className="heroCopy">
          <p className="eyebrow">Static preview operations</p>
          <h1>Ship a static preview with a review room attached</h1>
          <p className="lede">
            Push a static build from the dashboard or the CLI, share a versioned preview URL, and collect comments your agents can read and act on.
          </p>
          <div className="heroActions">
            <Link className="primary" href="/docs/self-hosting">
              Start self-hosting <ArrowRight size={15} />
            </Link>
            <Link href="/docs/how-it-works">How it works</Link>
          </div>
        </div>

        <div className="previewPlane" aria-label="OpenDrop preview with comments">
          <div className="canvas">
            <div className="browserBar">/reviewer/qa-demo?version=4</div>
            <div className="mockPage">
              <strong>Preview the artifact, not a screenshot.</strong>
              <div className="mockLine" />
              <div className="mockLine" />
              <div className="mockLine short" />
            </div>
            <div className="highlightBand" />
            <div className="pin one">1</div>
          </div>
          <aside className="commentRail">
            <div className="thread">
              The hero heading feels small on desktop.
              <span>You · v4 · open</span>
            </div>
            <div className="thread">
              Typo: this should read preview, not previe.
              <span>You · highlight · open</span>
            </div>
            <div className="thread">
              CLI fetch includes these annotations.
              <span>agent · current page</span>
            </div>
          </aside>
        </div>
      </section>

      <section className="section">
        <div className="sectionInner">
          <p className="sectionKicker">Feature set</p>
          <h2 className="sectionTitle">Everything needed for a useful V1, without hiding the moving parts.</h2>
          <div className="featureRows">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <div className="featureRow" key={feature.title}>
                  <strong>{feature.title}</strong>
                  <p>{feature.body}</p>
                  <Icon size={18} />
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="sectionInner">
          <p className="sectionKicker">Documentation</p>
          <h2 className="sectionTitle">Deploy it, extend it, and understand the review model.</h2>
          <div className="docsGrid">
            {docs.map(([title, body, href]) => (
              <Link className="docTile" href={href} key={href}>
                <strong>{title}</strong>
                <span>{body}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="section finalCta">
        <p className="sectionKicker">Built for teams and agents</p>
        <h2 className="sectionTitle">A preview URL that carries files, versions, comments, and enough context to automate review.</h2>
        <Link className="primary" href="/docs">
          Read the docs <ArrowRight size={15} />
        </Link>
      </section>
    </main>
  );
}
