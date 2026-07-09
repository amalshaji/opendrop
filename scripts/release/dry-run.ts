import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const server = JSON.parse(readFileSync("apps/server/package.json", "utf8"));
const cli = JSON.parse(readFileSync("apps/cli/package.json", "utf8"));

if (!server.version) throw new Error("Missing server version.");
if (cli.name !== "opendrop") throw new Error("CLI package must publish as opendrop.");
if (!cli.version) throw new Error("Missing CLI version.");

const validLabels = runLabels(["release:server", "release:cli", "semver:minor"]);
if (!validLabels.stdout.includes("server=true")) throw new Error("Release dry-run did not detect release:server.");
if (!validLabels.stdout.includes("cli=true")) throw new Error("Release dry-run did not detect release:cli.");
if (!validLabels.stdout.includes("semver=minor")) throw new Error("Release dry-run did not detect semver:minor.");

const invalidLabels = runLabels(["release:server", "semver:banana"]);
if (invalidLabels.status === 0) throw new Error("Release dry-run accepted an invalid semver label.");

const cliNotes = runNotes("cli", cli.version, ["release:cli", "semver:minor"]);
if (!cliNotes.stdout.includes("npm package")) throw new Error("CLI release notes did not include npm package details.");
if (!cliNotes.stdout.includes(`opendrop@${cli.version}`)) throw new Error("CLI release notes did not include the package version.");

const serverNotes = runNotes("server", server.version, ["release:server", "semver:patch"]);
if (!serverNotes.stdout.includes("server image")) throw new Error("Server release notes did not include image details.");
if (!serverNotes.stdout.includes(`ghcr.io/amalshaji/opendrop-server:${server.version}`)) throw new Error("Server release notes did not include the image version.");

console.log(`server=${server.version}`);
console.log(`cli=${cli.version}`);
console.log("labels=ok");
console.log("release-notes=ok");

function runLabels(labels: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ["scripts/release/labels.mjs", JSON.stringify(labels)], {
    encoding: "utf8"
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr
  };
}

function runNotes(target: string, version: string, labels: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ["scripts/release/notes.ts"], {
    encoding: "utf8",
    env: {
      ...process.env,
      RELEASE_TARGET: target,
      RELEASE_VERSION: version,
      RELEASE_PR_NUMBER: "123",
      RELEASE_PR_TITLE: "Release test",
      RELEASE_PR_BODY: "Release body",
      RELEASE_LABELS: JSON.stringify(labels),
      RELEASE_IMAGE: "ghcr.io/amalshaji/opendrop-server"
    }
  });
  if (result.status !== 0) throw new Error(result.stderr || `notes failed for ${target}`);
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr
  };
}
