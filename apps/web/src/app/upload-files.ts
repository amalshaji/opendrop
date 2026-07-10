import {
  filesFromZip,
  isDirectUploadFallbackCode,
  mapWithConcurrency,
  normalizeUploadRoot,
  uploadSessionCreateResponseSchema,
  uploadSessionUrlsResponseSchema,
  validateUploadFiles,
  publishResultWithValidation,
  type UploadFileLike,
  type ValidationResult,
  type Visibility
} from "@opendrop/shared/core";
import type { WebkitDataTransferItem, WebkitDirectoryEntry, WebkitEntry, WebkitFileEntry } from "./types";

export function uploadFormData(files: File[], metadata: { namespace?: string; slug?: string; visibility?: Visibility }) {
  const data = new FormData();
  for (const file of files) {
    data.append("files", file, uploadPath(file));
  }
  if (metadata.namespace) data.append("namespace", metadata.namespace);
  if (metadata.slug) data.append("slug", metadata.slug);
  if (metadata.visibility) data.append("visibility", metadata.visibility);
  return data;
}

export type BrowserDirectUploadResult =
  | { kind: "published"; result: Record<string, unknown> }
  | { kind: "unavailable" };

export async function validateBrowserUpload(files: File[]): Promise<ValidationResult> {
  return validateUploadFiles(await prepareUploadFiles(files));
}

export async function publishDirectUpload(
  files: File[],
  metadata: { namespace?: string; slug?: string; visibility?: Visibility },
  onProgress: (completed: number, total: number) => void
): Promise<BrowserDirectUploadResult> {
  const preparedFiles = await prepareUploadFiles(files);
  const validation = await validateUploadFiles(preparedFiles);
  if (!validation.ok) throw new Error(validation.issues.map((issue) => issue.message).join(" "));
  const bytesByPath = new Map(normalizeUploadRoot(preparedFiles).map((file) => [file.path, file.bytes]));
  const createResponse = await fetch("/api/uploads/sessions", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...metadata, manifest: validation.acceptedFiles })
  });
  if (!createResponse.ok) {
    const body = await createResponse.json().catch(() => null) as { code?: string; error?: string } | null;
    if ([413, 501, 503].includes(createResponse.status) && isDirectUploadFallbackCode(body?.code)) {
      return { kind: "unavailable" };
    }
    throw new Error(body?.error ?? `Upload session creation failed (${createResponse.status}).`);
  }
  const session = uploadSessionCreateResponseSchema.parse(await createResponse.json());
  for (let offset = 0; offset < validation.acceptedFiles.length; offset += 100) {
    const paths = validation.acceptedFiles.slice(offset, offset + 100).map((file) => file.path);
    const urlsResponse = await fetch(`/api/uploads/sessions/${session.sessionId}/urls`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paths })
    });
    if (!urlsResponse.ok) throw new Error(await responseError(urlsResponse, "Upload URL creation failed."));
    const targets = uploadSessionUrlsResponseSchema.parse(await urlsResponse.json());
    await mapWithConcurrency(targets.uploads, 4, async (target) => {
      const bytes = bytesByPath.get(target.path);
      if (!bytes) throw new Error(`Missing bytes for ${target.path}`);
      const response = await fetch(target.url, {
        method: "PUT",
        headers: target.headers,
        body: bytesToArrayBuffer(bytes)
      });
      if (!response.ok) throw new Error(`Direct upload failed for ${target.path} (${response.status}).`);
    }, (completed) => onProgress(offset + completed, validation.acceptedFiles.length));
  }
  const finalizeResponse = await fetch(`/api/uploads/sessions/${session.sessionId}/finalize`, {
    method: "POST",
    credentials: "include"
  });
  if (!finalizeResponse.ok) throw new Error(await responseError(finalizeResponse, "Upload finalization failed."));
  return {
    kind: "published",
    result: publishResultWithValidation(await finalizeResponse.json() as Record<string, unknown>, validation)
  };
}

async function prepareUploadFiles(files: File[]): Promise<UploadFileLike[]> {
  if (files.length === 1 && (files[0]!.name.toLowerCase().endsWith(".zip") || files[0]!.type === "application/zip")) {
    return filesFromZip(new Uint8Array(await files[0]!.arrayBuffer()));
  }
  const prepared: UploadFileLike[] = [];
  for (const file of files) {
    prepared.push({
      path: uploadPath(file),
      bytes: new Uint8Array(await file.arrayBuffer()),
      contentType: file.type || undefined
    });
  }
  return prepared;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function responseError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? fallback;
}

export function uploadPath(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

export function displayUploadPath(file: File): string {
  return uploadPath(file).replace(/\//g, " / ");
}

export async function filesFromDataTransfer(dataTransfer: DataTransfer): Promise<File[]> {
  const entries = Array.from(dataTransfer.items || [])
    .map(getWebkitEntry)
    .filter((entry): entry is WebkitEntry => Boolean(entry));
  if (entries.length > 0) {
    return (await Promise.all(entries.map((entry) => filesFromEntry(entry, "")))).flat();
  }
  return Array.from(dataTransfer.files || []);
}

function getWebkitEntry(item: DataTransferItem): WebkitEntry | null {
  const getEntry = (item as unknown as WebkitDataTransferItem).webkitGetAsEntry;
  return typeof getEntry === "function" ? getEntry.call(item) : null;
}

async function filesFromEntry(entry: WebkitEntry, parentPath: string): Promise<File[]> {
  const entryPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file = await readFileEntry(entry as WebkitFileEntry);
    return [fileWithPath(file, entryPath)];
  }
  if (!entry.isDirectory) return [];
  const childEntries = await readDirectoryEntry(entry as WebkitDirectoryEntry);
  return (await Promise.all(childEntries.map((childEntry) => filesFromEntry(childEntry, entryPath)))).flat();
}

function readFileEntry(entry: WebkitFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function readDirectoryEntry(entry: WebkitDirectoryEntry): Promise<WebkitEntry[]> {
  const reader = entry.createReader();
  const entries: WebkitEntry[] = [];
  while (true) {
    const batch = await new Promise<WebkitEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) break;
    entries.push(...batch);
  }
  return entries;
}

function fileWithPath(file: File, path: string): File {
  if (uploadPath(file) === path) return file;
  return new File([file], path, { type: file.type, lastModified: file.lastModified });
}
