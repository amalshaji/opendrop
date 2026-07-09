const labels = JSON.parse(process.argv[2] || "[]");
const has = (label) => labels.includes(label);
const allowedSemver = new Set(["semver:patch", "semver:minor", "semver:major"]);
const semver = labels.find((label) => label.startsWith("semver:")) || "";
if ((has("release:server") || has("release:cli")) && !allowedSemver.has(semver)) {
  console.error("Release PRs must include semver:patch, semver:minor, or semver:major.");
  process.exit(1);
}
const outputs = {
  server: String(has("release:server")),
  cli: String(has("release:cli")),
  semver: semver.replace("semver:", "")
};
for (const [key, value] of Object.entries(outputs)) {
  console.log(`${key}=${value}`);
}
if (process.env.GITHUB_OUTPUT) {
  const fs = await import("node:fs");
  fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(outputs).map(([key, value]) => `${key}=${value}`).join("\n") + "\n");
}
