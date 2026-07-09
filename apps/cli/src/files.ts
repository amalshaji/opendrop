import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";

export interface CliUploadFile {
  path: string;
  bytes: Uint8Array;
  type: string;
}

export async function collectUploadFiles(inputPath: string): Promise<CliUploadFile[]> {
  const inputStat = await stat(inputPath);
  if (inputStat.isFile()) {
    return [{ path: basename(inputPath), bytes: await readFile(inputPath), type: contentType(inputPath) }];
  }
  const files: CliUploadFile[] = [];
  await walk(inputPath, inputPath, files);
  return files;
}

async function walk(root: string, current: string, out: CliUploadFile[]) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const fullPath = join(current, entry.name);
    if (entry.isDirectory()) {
      await walk(root, fullPath, out);
    } else if (entry.isFile()) {
      out.push({
        path: relative(root, fullPath).replace(/\\/g, "/"),
        bytes: await readFile(fullPath),
        type: contentType(fullPath)
      });
    }
  }
}

function contentType(path: string): string {
  if (path.endsWith(".html")) return "text/html";
  if (path.endsWith(".css")) return "text/css";
  if (path.endsWith(".js")) return "text/javascript";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".zip")) return "application/zip";
  return "application/octet-stream";
}
