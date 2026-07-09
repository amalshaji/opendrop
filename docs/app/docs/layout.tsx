import type { ReactNode } from "react";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";
import { source } from "@/lib/source";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RootProvider theme={{ enabled: false }}>
      <DocsLayout
        tree={source.pageTree}
        nav={{
          title: (
            <span className="docsBrand">
              <span className="docsBrandMark"><img src="/opendrop-logo.svg" alt="" /></span>
              OpenDrop
            </span>
          ),
          url: "/"
        }}
        themeSwitch={{ enabled: false }}
      >
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
