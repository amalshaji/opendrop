import { notFound } from "next/navigation";
import type { TOCItemType } from "fumadocs-core/toc";
import defaultMdxComponents, { createRelativeLink } from "fumadocs-ui/mdx";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/page";
import type { MDXContent } from "mdx/types";
import { source } from "@/lib/source";

type OpenDropDocData = {
  title: string;
  description?: string;
  full?: boolean;
  toc?: TOCItemType[];
  body: MDXContent;
};

export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();

  const data = page.data as OpenDropDocData;
  const MDX = data.body;
  const components = {
    ...defaultMdxComponents,
    a: createRelativeLink(source, page)
  };

  return (
    <DocsPage toc={data.toc} full={data.full}>
      <DocsTitle>{data.title}</DocsTitle>
      <DocsDescription>{data.description}</DocsDescription>
      <DocsBody>
        <MDX components={components} />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();
  const data = page.data as OpenDropDocData;
  return {
    title: `${data.title} - OpenDrop`,
    description: data.description
  };
}
