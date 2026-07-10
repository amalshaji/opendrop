import {
  filesFromZip,
  prepareDirectUpload,
  runDirectUpload,
  type DirectUploadResult,
  type UploadFileLike,
  type Visibility
} from "@opendrop/shared/core";
import type { CliUploadFile } from "@/files";
import { apiFetchRaw } from "@/http";

export async function publishDirectUpload(
  files: CliUploadFile[],
  metadata: { namespace?: string; slug?: string; visibility?: Visibility },
  server?: string
): Promise<DirectUploadResult> {
  const prepared = await prepareDirectUpload(prepareFiles(files));
  return runDirectUpload(prepared, metadata, {
    request: (path, init) => apiFetchRaw(path, { ...init, server })
  });
}

function prepareFiles(files: CliUploadFile[]): UploadFileLike[] {
  if (files.length === 1 && (files[0]!.path.endsWith(".zip") || files[0]!.type === "application/zip")) {
    return filesFromZip(files[0]!.bytes);
  }
  return files.map((file) => ({ path: file.path, bytes: file.bytes, contentType: file.type }));
}
