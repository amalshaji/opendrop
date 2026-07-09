import { z } from "zod";
import { normalizeArtifactPath } from "./paths";

export const visibilitySchema = z.enum(["public", "private"]);
export type Visibility = z.infer<typeof visibilitySchema>;

export const deploymentVersionSchema = z.object({
  id: z.string(),
  versionNumber: z.number().int().positive(),
  createdAt: z.string(),
  createdByUserId: z.string(),
  manifestHash: z.string(),
  fileCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative()
});

export type DeploymentVersion = z.infer<typeof deploymentVersionSchema>;

export const fileManifestEntrySchema = z.object({
  path: z.string(),
  size: z.number().int().nonnegative(),
  sha256: z.string(),
  contentType: z.string(),
  lineCount: z.number().int().nonnegative().optional()
});

export type FileManifestEntry = z.infer<typeof fileManifestEntrySchema>;

export const validationIssueSchema = z.object({
  code: z.string(),
  severity: z.enum(["error", "warning", "skipped"]),
  path: z.string().optional(),
  message: z.string()
});

export type ValidationIssue = z.infer<typeof validationIssueSchema>;

export const validationResultSchema = z.object({
  ok: z.boolean(),
  hasIndexHtml: z.boolean(),
  acceptedFiles: z.array(fileManifestEntrySchema),
  skippedFiles: z.array(fileManifestEntrySchema),
  issues: z.array(validationIssueSchema),
  totalAcceptedBytes: z.number().int().nonnegative(),
  totalSkippedBytes: z.number().int().nonnegative(),
  totalLineCount: z.number().int().nonnegative()
});

export type ValidationResult = z.infer<typeof validationResultSchema>;

export const annotationTagsSchema = z.array(z.string().trim().min(1).max(64)).max(20);

const normalizedCoordinateSchema = z.number().min(0).max(1);
const annotationElementAnchorSchema = z.object({
  kind: z.literal("element"),
  selector: z.string().min(1).max(2048),
  x: normalizedCoordinateSchema,
  y: normalizedCoordinateSchema
});
const annotationTextRangeAnchorSchema = z.object({
  kind: z.literal("text-range"),
  startPath: z.string().max(2048),
  startOffset: z.number().int().nonnegative(),
  endPath: z.string().max(2048),
  endOffset: z.number().int().nonnegative(),
  quote: z.string().max(2000).optional()
});
const annotationPagePathSchema = z
  .string()
  .max(2048)
  .default("/")
  .transform((value) => value || "/")
  .refine((value) => {
    const withoutQuery = value.split("?")[0] ?? "/";
    return normalizeArtifactPath(withoutQuery === "/" ? "index.html" : withoutQuery) !== null;
  }, "Invalid page path.");

export const annotationShapeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("pin"),
    x: normalizedCoordinateSchema,
    y: normalizedCoordinateSchema,
    anchor: annotationElementAnchorSchema.optional()
  }),
  z.object({
    type: z.literal("region"),
    x: normalizedCoordinateSchema,
    y: normalizedCoordinateSchema,
    width: normalizedCoordinateSchema,
    height: normalizedCoordinateSchema
  }),
  z.object({
    type: z.literal("freehand"),
    points: z.array(z.object({ x: normalizedCoordinateSchema, y: normalizedCoordinateSchema })).min(1).max(400)
  }),
  z.object({
    type: z.literal("note"),
    x: normalizedCoordinateSchema,
    y: normalizedCoordinateSchema,
    anchor: annotationElementAnchorSchema.optional()
  }),
  z.object({
    type: z.literal("highlight"),
    rects: z
      .array(
        z.object({
          x: normalizedCoordinateSchema,
          y: normalizedCoordinateSchema,
          width: normalizedCoordinateSchema,
          height: normalizedCoordinateSchema
        })
      )
      .min(1)
      .max(400),
    text: z.string().max(2000).optional(),
    anchor: annotationTextRangeAnchorSchema.optional()
  })
]);

export type AnnotationShape = z.infer<typeof annotationShapeSchema>;

export const annotationViewportSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  scrollX: z.number().default(0),
  scrollY: z.number().default(0)
});

export const annotationInputSchema = z.object({
  pagePath: annotationPagePathSchema,
  versionId: z.string().optional(),
  parentAnnotationId: z.string().min(1).max(128).optional(),
  body: z.string().min(1).max(10_000),
  tags: annotationTagsSchema.default([]),
  shape: annotationShapeSchema,
  viewport: annotationViewportSchema
});

export type AnnotationInput = z.infer<typeof annotationInputSchema>;

export const annotationResolveInputSchema = z.object({
  resolved: z.boolean()
});

export type AnnotationResolveInput = z.infer<typeof annotationResolveInputSchema>;
