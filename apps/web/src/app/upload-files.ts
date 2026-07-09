import type { Visibility } from "@opendrop/shared/core";
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
