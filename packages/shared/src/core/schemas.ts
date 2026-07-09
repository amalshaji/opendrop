import { z } from "zod";
import { normalizeNamespace, validateNamespace } from "./namespace";
import { normalizeArtifactPath } from "./paths";
import { normalizeSlug, validateSlug } from "./slug";
import { visibilitySchema } from "./types";

const emptyStringToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

export const namespaceParamSchema = z.string().refine((value) => validateNamespace(value) === null, {
  message: "Invalid namespace."
});

export const slugParamSchema = z.string().refine((value) => validateSlug(value) === null, {
  message: "Invalid slug."
});

export const normalizedNamespaceInputSchema = z
  .string()
  .transform((value) => normalizeNamespace(value))
  .refine((value) => validateNamespace(value) === null, {
    message: "Invalid namespace."
  });

export const normalizedSlugInputSchema = z
  .string()
  .transform((value) => normalizeSlug(value))
  .refine((value) => validateSlug(value) === null, {
    message: "Invalid slug."
  });

export const optionalNormalizedNamespaceInputSchema = z.preprocess(emptyStringToUndefined, normalizedNamespaceInputSchema.optional());
export const optionalNormalizedSlugInputSchema = z.preprocess(emptyStringToUndefined, normalizedSlugInputSchema.optional());

export const versionIdSchema = z.string().min(1).max(128);
export const optionalVersionIdSchema = z.preprocess(emptyStringToUndefined, versionIdSchema.optional());

export const deploymentRefSchema = z.object({
  namespace: namespaceParamSchema,
  slug: slugParamSchema
});

export const deploymentRefInputSchema = z.string().trim().min(1).transform((ref, ctx) => {
  const parts = targetPathParts(ref);
  const parsed = deploymentRefSchema.safeParse({
    namespace: parts[0],
    slug: parts[1]
  });
  if (parsed.success) return parsed.data;
  addNestedIssues(ctx, parsed.error);
  return z.NEVER;
});

export const versionedDeploymentRefSchema = deploymentRefSchema.extend({
  versionId: versionIdSchema
});

export const publishedDeploymentSchema = z.object({
  family: z.object({
    id: z.string().min(1),
    namespaceName: namespaceParamSchema,
    slug: slugParamSchema,
    visibility: visibilitySchema,
    updatedAt: z.string().min(1)
  }),
  version: z.object({
    id: versionIdSchema,
    versionNumber: z.number().int().positive(),
    fileCount: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative()
  })
});

export const publishedDeploymentsResponseSchema = z.object({
  deployments: z.array(publishedDeploymentSchema)
});

export type PublishedDeployment = z.infer<typeof publishedDeploymentSchema>;

export const uploadMetadataSchema = z.object({
  namespace: optionalNormalizedNamespaceInputSchema,
  slug: optionalNormalizedSlugInputSchema,
  visibility: z.preprocess(emptyStringToUndefined, visibilitySchema.optional())
});

export const namespaceRouteParamsSchema = z.object({
  namespace: namespaceParamSchema
});

export const namespacePublisherRouteParamsSchema = namespaceRouteParamsSchema.extend({
  userId: z.string().min(1).max(128)
});

export const namespaceCreateBodySchema = z.object({
  name: normalizedNamespaceInputSchema
});

export const namespacePublisherBodySchema = z.object({
  email: z.string().trim().toLowerCase().email()
});

export const visibilityUpdateBodySchema = z.object({
  visibility: visibilitySchema
});

export const pagePathSchema = z
  .preprocess(emptyStringToUndefined, z.string().max(2048).default("/"))
  .transform((value) => value || "/")
  .refine((value) => safePagePath(value), {
    message: "Invalid page path."
  });

export const optionalPagePathSchema = z
  .preprocess(emptyStringToUndefined, z.string().max(2048).optional())
  .refine((value) => value === undefined || safePagePath(value), {
    message: "Invalid page path."
  });

export const pageQuerySchema = z.object({
  path: pagePathSchema,
  versionId: optionalVersionIdSchema
});

export const annotationQuerySchema = z.object({
  path: optionalPagePathSchema,
  versionId: optionalVersionIdSchema
});

export const artifactRoutePathSchema = z
  .string()
  .max(2048)
  .default("index.html")
  .transform((value) => value || "index.html")
  .refine((value) => normalizeArtifactPath(value) !== null, {
    message: "Invalid artifact path."
  });

export const devLoginParamsSchema = z.object({
  email: z.string().email()
});

export const devLoginBodySchema = z.object({
  email: z.string().email().default("dev@example.com"),
  name: z.string().min(1).max(120).default("Dev User")
});

export const safeReturnPathSchema = z.preprocess(emptyStringToUndefined, z.string().optional()).transform((value) => {
  if (!value) return undefined;
  return value.startsWith("/") && !value.startsWith("//") ? value : undefined;
});

export const safeReturnQuerySchema = z.object({
  returnTo: safeReturnPathSchema,
  name: z.preprocess(emptyStringToUndefined, z.string().min(1).max(120).optional()),
  json: z.preprocess(emptyStringToUndefined, z.string().optional())
});

export const cliTokenBodySchema = z.object({
  label: z.string().min(1).max(120).default("cli")
});

export const cliConnectionParamsSchema = z.object({
  id: z.string().min(1).max(128)
});

export const annotationIdParamSchema = z.object({
  annotationId: z.string().min(1).max(128)
});

export const deviceCodeBodySchema = z.object({
  label: z.string().min(1).max(120).default("OpenDrop CLI"),
  deviceName: z.string().min(1).max(120).optional()
});

export const deviceRequestParamsSchema = z.object({
  userCode: z.string().min(1).max(32).transform((value) => value.toUpperCase())
});

export const deviceDecisionBodySchema = z.object({
  userCode: z.string().min(1).max(32).transform((value) => value.toUpperCase()),
  decision: z.enum(["approve", "reject"]).default("approve")
});

export const deviceTokenBodySchema = z.object({
  deviceCode: z.string().min(1)
});

export const deviceCodeResponseSchema = z.object({
  deviceCode: z.string().min(1),
  userCode: z.string().min(1),
  verificationUri: z.string().url(),
  verificationUriComplete: z.string().url(),
  expiresAt: z.string(),
  interval: z.coerce.number().int().positive().default(2)
});

export const deviceTokenResponseSchema = z.object({
  accessToken: z.string().min(1),
  tokenType: z.literal("Bearer")
});

export const fetchIncludePartSchema = z.enum(["html", "manifest", "annotations"]);
export const fetchIncludeSchema = z.preprocess(
  (value) => {
    if (Array.isArray(value)) return value;
    return String(value || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  },
  z.array(fetchIncludePartSchema).min(1)
);

export type FetchIncludePart = z.infer<typeof fetchIncludePartSchema>;

export const deploymentTargetSchema = z.string().trim().min(1).transform((target, ctx) => {
  const parts = targetPathParts(target);
  const effectiveParts = parts[0] === "preview" ? parts.slice(1) : parts;
  if (effectiveParts[2] === "versions" && effectiveParts[3]) {
    const parsed = versionedDeploymentRefSchema.safeParse({
      namespace: effectiveParts[0],
      slug: effectiveParts[1],
      versionId: effectiveParts[3]
    });
    if (parsed.success) return parsed.data;
    addNestedIssues(ctx, parsed.error);
    return z.NEVER;
  }
  if (parts[0] === "preview" && effectiveParts[2]) {
    const parsed = versionedDeploymentRefSchema.safeParse({
      namespace: effectiveParts[0],
      slug: effectiveParts[1],
      versionId: effectiveParts[2]
    });
    if (parsed.success) return parsed.data;
    addNestedIssues(ctx, parsed.error);
    return z.NEVER;
  }
  const queryVersion = targetVersionQuery(target);
  if (queryVersion) {
    const parsed = versionedDeploymentRefSchema.safeParse({
      namespace: effectiveParts[0],
      slug: effectiveParts[1],
      versionId: queryVersion
    });
    if (parsed.success) return parsed.data;
    addNestedIssues(ctx, parsed.error);
    return z.NEVER;
  }
  const parsed = deploymentRefSchema.safeParse({
    namespace: effectiveParts[0],
    slug: effectiveParts[1]
  });
  if (parsed.success) return parsed.data;
  addNestedIssues(ctx, parsed.error);
  return z.NEVER;
});

export const previewRoutePathSchema = z.string().transform((pathname, ctx) => {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 2) {
    const parsed = deploymentRefSchema.safeParse({ namespace: parts[0], slug: parts[1] });
    if (parsed.success) return parsed.data;
    addNestedIssues(ctx, parsed.error);
    return z.NEVER;
  }
  if (parts.length === 4 && parts[2] === "versions") {
    const parsed = versionedDeploymentRefSchema.safeParse({ namespace: parts[0], slug: parts[1], versionId: parts[3] });
    if (parsed.success) return parsed.data;
    addNestedIssues(ctx, parsed.error);
    return z.NEVER;
  }
  ctx.addIssue({ code: "custom", message: "Expected /namespace/slug or /namespace/slug/versions/versionId." });
  return z.NEVER;
});

function targetPathParts(target: string): string[] {
  return new URL(target, "https://opendrop.local").pathname.split("/").filter(Boolean);
}

function targetVersionQuery(target: string): string | undefined {
  const value = new URL(target, "https://opendrop.local").searchParams.get("version");
  return value && value.length > 0 ? value : undefined;
}

function addNestedIssues(ctx: z.RefinementCtx, error: z.ZodError) {
  for (const issue of error.issues) {
    ctx.addIssue({
      code: "custom",
      path: issue.path,
      message: issue.message
    });
  }
}

function safePagePath(value: string): boolean {
  const withoutQuery = value.split("?")[0] ?? "/";
  return normalizeArtifactPath(withoutQuery === "/" ? "index.html" : withoutQuery) !== null;
}
