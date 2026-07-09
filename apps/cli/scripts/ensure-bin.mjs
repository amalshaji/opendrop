import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const binPath = resolve("dist/index.js");
const current = readFileSync(binPath, "utf8");
if (!current.startsWith("#!/usr/bin/env node")) {
  writeFileSync(binPath, `#!/usr/bin/env node\n${current}`);
}
chmodSync(binPath, 0o755);
