import type { Hono } from "hono";
import { z } from "zod";
import {
  DEFAULT_VALIDATION_LIMITS,
  filesFromZip,
  manifestHash,
  normalizeArtifactPath,
  normalizeUploadRoot,
  randomId,
  randomSlug,
  storageKey,
  uploadMetadataSchema,
  validateUploadFiles,
  ZipUploadLimitError,
  type UploadFileLike
} from "@opendrop/shared/core";
import type { OpenDropAuthConfig } from "@opendrop/shared/auth";
import type { OpenDropRepository } from "@opendrop/shared/db/repository";
import type { ArtifactStorage } from "@opendrop/shared/storage/interface";
import type { AppBindings, OpenDropContext } from "@/app-types";
import { repositoryMutationError, requireAuth, validationError } from "@/http-helpers";
import { registerUploadSessionRoutes } from "@/upload-sessions";
import { publishResponse } from "@/upload-response";

const submittedFormFileSchema = z.custom<File>(
  (value): value is File => typeof value === "object" && value !== null && "arrayBuffer" in value && "name" in value,
  { message: "Expected an uploaded file." }
);
const submittedFormFilesSchema = z.array(submittedFormFileSchema);
const MAX_UPLOAD_REQUEST_BYTES = DEFAULT_VALIDATION_LIMITS.maxTotalBytes + 10 * 1024 * 1024;

interface UploadRouteOptions {
  repo: OpenDropRepository;
  storage: ArtifactStorage;
  authConfig: OpenDropAuthConfig;
}

export function registerUploadRoutes(app: Hono<AppBindings>, { repo, storage, authConfig }: UploadRouteOptions) {
  registerUploadSessionRoutes(app, { repo, storage, authConfig });
  app.post("/api/uploads/validate", async (c) => {
    const auth = requireAuth(c);
    if (auth instanceof Response) return auth;
    const files = await filesFromForm(c);
    if (files instanceof Response) return files;
    const validation = await validateUploadFiles(files);
    return c.json(validation, validation.ok ? 200 : 422);
  });

  app.post("/api/uploads/publish", async (c) => {
    const auth = requireAuth(c);
    if (auth instanceof Response) return auth;
    const uploadSizeError = oversizedUploadError(c);
    if (uploadSizeError) return uploadSizeError;
    const form = await c.req.formData();
    const metadata = uploadMetadataSchema.safeParse(formMetadata(form));
    if (!metadata.success) return validationError(c, metadata.error);
    const namespace = metadata.data.namespace ?? auth.user.defaultNamespace;
    const slug = metadata.data.slug ?? randomSlug();
    const visibility = metadata.data.visibility ?? authConfig.defaultVisibility;
    if (!(await repo.userCanPublishNamespace(auth.user.id, namespace))) {
      return c.json({ error: "You do not have publish access to this namespace." }, 403);
    }
    const submittedFiles = await filesFromSubmittedForm(c, form);
    if (submittedFiles instanceof Response) return submittedFiles;
    const files = normalizeUploadRoot(submittedFiles);
    const validation = await validateUploadFiles(files);
    if (!validation.ok) return c.json(validation, 422);

    const plannedVersionId = randomId("ver_");
    const uploadPrefix = storageKey(namespace, slug, plannedVersionId, "");
    const fileBytesByPath = fileBytesByNormalizedPath(files);
    const filesWithKeys = validation.acceptedFiles.map((file) => ({
      ...file,
      storageKey: storageKey(namespace, slug, plannedVersionId, file.path)
    }));
    const computedManifestHash = await manifestHash(validation.acceptedFiles);
    let attemptedStorageWrite = false;
    try {
      for (const file of filesWithKeys) {
        const bytes = fileBytesByPath.get(file.path);
        if (!bytes) throw new Error(`Missing bytes for ${file.path}`);
        attemptedStorageWrite = true;
        await storage.putObject(file.storageKey, bytes, file.contentType);
      }
    } catch {
      if (attemptedStorageWrite) await storage.deletePrefix(uploadPrefix).catch(() => undefined);
      return c.json({ error: "Artifact storage write failed." }, 502);
    }

    const version = await repo
      .createDeploymentVersion({
        namespace,
        slug,
        versionId: plannedVersionId,
        ownerUserId: auth.user.id,
        visibility,
        manifestHash: computedManifestHash,
        files: filesWithKeys
      })
      .catch((error) => repositoryMutationError(c, error));
    if (version instanceof Response) {
      await storage.deletePrefix(uploadPrefix).catch(() => undefined);
      return version;
    }

    return c.json(publishResponse(namespace, slug, visibility, version, validation));
  });
}

async function filesFromForm(c: OpenDropContext): Promise<UploadFileLike[] | Response> {
  const uploadSizeError = oversizedUploadError(c);
  if (uploadSizeError) return uploadSizeError;
  return filesFromSubmittedForm(c, await c.req.raw.formData());
}

async function filesFromSubmittedForm(c: OpenDropContext, form: FormData): Promise<UploadFileLike[] | Response> {
  const parsedFiles = submittedFormFilesSchema.safeParse(form.getAll("files"));
  if (!parsedFiles.success) return validationError(c, parsedFiles.error);
  const files = parsedFiles.data;
  if (files.length === 1 && (files[0].name.endsWith(".zip") || files[0].type === "application/zip")) {
    const zipSizeError = oversizedSubmittedZipError(c, files[0]);
    if (zipSizeError) return zipSizeError;
    try {
      return filesFromZip(new Uint8Array(await files[0].arrayBuffer()), DEFAULT_VALIDATION_LIMITS);
    } catch (error) {
      if (error instanceof ZipUploadLimitError) return c.json({ error: error.message }, 413);
      return c.json({ error: "Invalid zip upload." }, 400);
    }
  }
  const submittedFilesSizeError = oversizedSubmittedFilesError(c, files);
  if (submittedFilesSizeError) return submittedFilesSizeError;
  return Promise.all(
    files.map(async (file) => ({
      path: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      contentType: file.type || undefined
    }))
  );
}

function oversizedUploadError(c: OpenDropContext): Response | null {
  const rawContentLength = c.req.header("content-length");
  if (!rawContentLength) return null;
  const contentLength = Number(rawContentLength);
  if (!Number.isFinite(contentLength) || contentLength <= MAX_UPLOAD_REQUEST_BYTES) return null;
  return c.json({ error: `Upload request exceeds ${MAX_UPLOAD_REQUEST_BYTES} bytes.` }, 413);
}

function oversizedSubmittedZipError(c: OpenDropContext, file: File): Response | null {
  if (file.size <= MAX_UPLOAD_REQUEST_BYTES) return null;
  return c.json({ error: `Zip upload exceeds ${MAX_UPLOAD_REQUEST_BYTES} bytes.` }, 413);
}

function oversizedSubmittedFilesError(c: OpenDropContext, files: File[]): Response | null {
  let totalSize = 0;
  for (const file of files) {
    if (file.size > DEFAULT_VALIDATION_LIMITS.maxFileBytes) {
      return c.json({ error: `File ${file.name} exceeds ${DEFAULT_VALIDATION_LIMITS.maxFileBytes} bytes.` }, 413);
    }
    totalSize += file.size;
    if (totalSize > DEFAULT_VALIDATION_LIMITS.maxTotalBytes) {
      return c.json({ error: `Upload files exceed ${DEFAULT_VALIDATION_LIMITS.maxTotalBytes} bytes.` }, 413);
    }
  }
  return null;
}

function fileBytesByNormalizedPath(files: UploadFileLike[]): Map<string, Uint8Array> {
  const bytesByPath = new Map<string, Uint8Array>();
  for (const file of files) {
    const normalizedPath = normalizeArtifactPath(file.path);
    if (normalizedPath) bytesByPath.set(normalizedPath, file.bytes);
  }
  return bytesByPath;
}

function formMetadata(form: FormData): Record<string, string | undefined> {
  return {
    namespace: formString(form, "namespace"),
    slug: formString(form, "slug"),
    visibility: formString(form, "visibility")
  };
}

function formString(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
