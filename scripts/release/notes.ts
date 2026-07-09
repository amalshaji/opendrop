const target = requireEnv("RELEASE_TARGET");
const version = requireEnv("RELEASE_VERSION");
const serverImage = process.env.RELEASE_IMAGE || "ghcr.io/amalshaji/opendrop-server";
const prNumber = process.env.RELEASE_PR_NUMBER || "";
const prTitle = process.env.RELEASE_PR_TITLE || "Merged release PR";
const prBody = process.env.RELEASE_PR_BODY || "";
const labels = parseLabels(process.env.RELEASE_LABELS || "[]");

if (target !== "cli" && target !== "server") {
  throw new Error("RELEASE_TARGET must be cli or server.");
}

const title = target === "cli" ? `OpenDrop CLI v${version}` : `OpenDrop Server v${version}`;
const artifact = target === "cli" ? `npm package \`opendrop@${version}\`` : `server image \`${serverImage}:${version}\``;
const install = target === "cli" ? `\`npx opendrop@${version}\`` : `\`docker pull ${serverImage}:${version}\``;
const source = prNumber ? `#${prNumber} ${prTitle}` : prTitle;
const sourceLabel = prNumber ? "PR" : "Source";

console.log(`# ${title}`);
console.log("");
console.log(`Published ${artifact}.`);
console.log("");
console.log("## Install");
console.log("");
console.log(install);
console.log("");
console.log("## Source");
console.log("");
console.log(`- ${sourceLabel}: ${source}`);
console.log(`- Labels: ${labels.length ? labels.map((label) => `\`${label}\``).join(", ") : "none"}`);

if (prBody.trim()) {
  console.log("");
  console.log("## Notes");
  console.log("");
  console.log(prBody.trim());
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function parseLabels(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
