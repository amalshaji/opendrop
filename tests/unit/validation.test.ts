import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { filesFromZip, validateUploadFiles, ZipUploadLimitError } from "@opendrop/shared/core";

describe("upload validation", () => {
  it("requires root index.html", async () => {
    const result = await validateUploadFiles([{ path: "about.html", bytes: new TextEncoder().encode("<h1>About</h1>") }]);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === "missing_index_html")).toBe(true);
  });

  it("accepts a basic static site", async () => {
    const result = await validateUploadFiles([
      { path: "index.html", bytes: new TextEncoder().encode("<link rel='stylesheet' href='/assets/app.css'>") },
      { path: "assets/app.css", bytes: new TextEncoder().encode("body { color: black; }") }
    ]);
    expect(result.ok).toBe(true);
    expect(result.acceptedFiles.map((file) => file.path)).toEqual(["index.html", "assets/app.css"]);
  });

  it("strips a single uploaded folder prefix when it contains index.html", async () => {
    const result = await validateUploadFiles([
      { path: "valid-site/index.html", bytes: new TextEncoder().encode("<h1>Home</h1>") },
      { path: "valid-site/assets/app.css", bytes: new TextEncoder().encode("body { color: black; }") }
    ]);
    expect(result.ok).toBe(true);
    expect(result.acceptedFiles.map((file) => file.path)).toEqual(["index.html", "assets/app.css"]);
  });

  it("rejects path traversal", async () => {
    const result = await validateUploadFiles([
      { path: "index.html", bytes: new TextEncoder().encode("ok") },
      { path: "../secret.txt", bytes: new TextEncoder().encode("no") }
    ]);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === "unsafe_path")).toBe(true);
  });

  it("rejects zip entries before inflating beyond configured limits", () => {
    const archive = zipSync({
      "index.html": new TextEncoder().encode("<h1>Home</h1>"),
      "assets/large.bin": new Uint8Array(16)
    });

    expect(() =>
      filesFromZip(archive, {
        maxFileBytes: 8,
        maxTotalBytes: 1024,
        maxFiles: 10,
        maxTextLines: 25_000
      })
    ).toThrow(ZipUploadLimitError);
  });
});
