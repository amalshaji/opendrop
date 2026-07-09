import type { ReactNode } from "react";
import type { Metadata } from "next";
import "fumadocs-ui/style.css";
import "./style.css";

export const metadata: Metadata = {
  title: "OpenDrop",
  description: "Open-source static preview drops with versioning, CLI publishing, and a full-screen review room for comments and highlights."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="light" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
