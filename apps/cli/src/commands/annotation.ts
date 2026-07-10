import type { Command } from "commander";
import { z } from "zod";
import {
  annotationIdParamSchema,
  annotationPageNoteInputSchema,
  annotationQuerySchema,
  annotationReplyInputSchema,
  annotationResolveInputSchema
} from "@opendrop/shared/core";
import { parseDeploymentTarget, searchParams, validationMessage } from "@/command-helpers";
import { apiFetch } from "@/http";

const serverOptionSchema = z.object({ server: z.string().url().optional() });
const annotationsOptionsSchema = serverOptionSchema.extend({
  path: z.string().optional(),
  versionId: z.string().optional()
});
const annotationAddOptionsSchema = serverOptionSchema.extend({
  body: z.string().min(1),
  path: z.string().min(1).default("/"),
  versionId: z.string().optional(),
  tag: z.array(z.string()).default([])
});
const annotationReplyOptionsSchema = serverOptionSchema.extend({ body: z.string().min(1) });

export function registerAnnotationCommands(program: Command): void {
  program
    .command("annotations")
    .argument("<url-or-ref>", "Preview URL or namespace/slug")
    .option("--server <url>", "OpenDrop server URL")
    .option("--path <path>", "Page path")
    .option("--version-id <versionId>", "Version id")
    .action(async (target, options) => {
      const parsedOptions = annotationsOptionsSchema.safeParse(options);
      if (!parsedOptions.success) throw new Error(validationMessage(parsedOptions.error));
      const { namespace, slug, versionId } = parseDeploymentTarget(target);
      const query = annotationQuerySchema.safeParse({ path: parsedOptions.data.path, versionId: parsedOptions.data.versionId ?? versionId });
      if (!query.success) throw new Error(validationMessage(query.error));
      const response = await apiFetch(`/api/deployments/${namespace}/${slug}/annotations?${searchParams(query.data)}`, {
        server: parsedOptions.data.server
      });
      console.log(JSON.stringify(await response.json(), null, 2));
    });

  const annotationCommand = program.command("annotation").description("Create and manage annotations");

  annotationCommand
    .command("add")
    .description("Add a page-level note")
    .argument("<url-or-ref>", "Preview URL or namespace/slug")
    .requiredOption("--body <text>", "Annotation body")
    .option("--server <url>", "OpenDrop server URL")
    .option("--path <path>", "Page path", "/")
    .option("--version-id <versionId>", "Version id")
    .option("--tag <tag>", "Annotation tag (repeatable)", (tag, tags: string[]) => [...tags, tag], [])
    .action(async (target, options) => {
      const parsedOptions = annotationAddOptionsSchema.safeParse(options);
      if (!parsedOptions.success) throw new Error(validationMessage(parsedOptions.error));
      const { namespace, slug, versionId } = parseDeploymentTarget(target);
      const body = annotationPageNoteInputSchema.safeParse({
        pagePath: parsedOptions.data.path,
        versionId: parsedOptions.data.versionId ?? versionId,
        body: parsedOptions.data.body,
        tags: parsedOptions.data.tag
      });
      if (!body.success) throw new Error(validationMessage(body.error));
      await printJson(`/api/deployments/${namespace}/${slug}/annotations/page-notes`, parsedOptions.data.server, "POST", body.data);
    });

  annotationCommand
    .command("reply")
    .description("Reply to an annotation")
    .argument("<url-or-ref>", "Preview URL or namespace/slug")
    .argument("<annotation-id>", "Parent annotation id")
    .requiredOption("--body <text>", "Reply body")
    .option("--server <url>", "OpenDrop server URL")
    .action(async (target, annotationId, options) => {
      const parsedOptions = annotationReplyOptionsSchema.safeParse(options);
      if (!parsedOptions.success) throw new Error(validationMessage(parsedOptions.error));
      const parsedAnnotationId = annotationIdParamSchema.safeParse({ annotationId });
      if (!parsedAnnotationId.success) throw new Error(validationMessage(parsedAnnotationId.error));
      const { namespace, slug } = parseDeploymentTarget(target);
      const body = annotationReplyInputSchema.parse({ body: parsedOptions.data.body });
      await printJson(
        `/api/deployments/${namespace}/${slug}/annotations/${parsedAnnotationId.data.annotationId}/replies`,
        parsedOptions.data.server,
        "POST",
        body
      );
    });

  for (const [name, resolved] of [["resolve", true], ["reopen", false]] as const) {
    annotationCommand
      .command(name)
      .description(resolved ? "Resolve an annotation" : "Reopen an annotation")
      .argument("<url-or-ref>", "Preview URL or namespace/slug")
      .argument("<annotation-id>", "Annotation id")
      .option("--server <url>", "OpenDrop server URL")
      .action(async (target, annotationId, options) => {
        const parsedOptions = serverOptionSchema.safeParse(options);
        if (!parsedOptions.success) throw new Error(validationMessage(parsedOptions.error));
        const parsedAnnotationId = annotationIdParamSchema.safeParse({ annotationId });
        if (!parsedAnnotationId.success) throw new Error(validationMessage(parsedAnnotationId.error));
        const { namespace, slug } = parseDeploymentTarget(target);
        await printJson(
          `/api/deployments/${namespace}/${slug}/annotations/${parsedAnnotationId.data.annotationId}`,
          parsedOptions.data.server,
          "PATCH",
          annotationResolveInputSchema.parse({ resolved })
        );
      });
  }
}

async function printJson(path: string, server: string | undefined, method: "POST" | "PATCH", body: unknown): Promise<void> {
  const response = await apiFetch(path, {
    server,
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  console.log(JSON.stringify(await response.json(), null, 2));
}
