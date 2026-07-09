const serverPort = process.env.OPENDROP_E2E_SERVER_PORT || "43300";
const managedServerUrl = `http://127.0.0.1:${serverPort}`;
const externalServerUrl = process.env.OPENDROP_E2E_SERVER_URL;
const serverUrl = externalServerUrl || managedServerUrl;
const composeFile = "docker-compose.e2e.yml";
const verboseCompose = ["1", "true"].includes((process.env.OPENDROP_E2E_COMPOSE_VERBOSE || "").toLowerCase());

const suites: Record<string, string[]> = {
  all: ["tests/e2e/cli.spec.ts", "tests/e2e/ui.spec.ts", "tests/e2e/matrix.spec.ts"],
  cli: ["tests/e2e/cli.spec.ts"],
  ui: ["tests/e2e/ui.spec.ts", "tests/e2e/matrix.spec.ts"]
};
const lifecycleCommands = new Set(["start", "down"]);

const suiteName = process.argv[2] || "all";
const selectedSpecs = suites[suiteName];

if (!selectedSpecs && !lifecycleCommands.has(suiteName)) {
  console.error(`Unknown E2E command "${suiteName}". Expected one of: ${[...Object.keys(suites), ...lifecycleCommands].join(", ")}.`);
  process.exit(1);
}

let shuttingDown = false;
let stopComposeOnSignal = false;
let stopComposeOnExit = false;

async function readOutput(stream: ReadableStream<Uint8Array> | null) {
  return stream ? await new Response(stream).text() : "";
}

async function run(command: string[], env: Bun.Env = process.env, quiet = false) {
  const captureOutput = quiet && !verboseCompose;
  const child = Bun.spawn(command, {
    env,
    stdout: captureOutput ? "pipe" : "inherit",
    stderr: captureOutput ? "pipe" : "inherit"
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    captureOutput ? readOutput(child.stdout) : Promise.resolve(""),
    captureOutput ? readOutput(child.stderr) : Promise.resolve("")
  ]);
  if (code !== 0) {
    if (captureOutput) {
      const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
      if (output) {
        console.error(`\n${command.join(" ")} output:\n${output}`);
      }
    }
    throw Object.assign(new Error(`${command.join(" ")} exited with code ${code}`), { code });
  }
}

async function runAllowFailure(command: string[], quiet = false) {
  const captureOutput = quiet && !verboseCompose;
  const child = Bun.spawn(command, {
    stdout: captureOutput ? "pipe" : "inherit",
    stderr: captureOutput ? "pipe" : "inherit"
  });
  await Promise.all([
    child.exited,
    captureOutput ? readOutput(child.stdout) : Promise.resolve(""),
    captureOutput ? readOutput(child.stderr) : Promise.resolve("")
  ]);
}

async function composeDown() {
  await runAllowFailure(["docker", "compose", "-f", composeFile, "down"], true);
}

async function composeStart() {
  await composeDown();
  await run(["docker", "compose", "-f", composeFile, "up", "-d", "--build", "app"], process.env, true);
  await waitForHealthz(managedServerUrl);
}

async function waitForHealthz(url: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 120_000) {
    try {
      const response = await fetch(`${url}/healthz`);
      if (response.ok) return;
    } catch {
      // Keep polling until Docker finishes starting the production server.
    }
    await Bun.sleep(500);
  }
  await runAllowFailure(["docker", "compose", "-f", composeFile, "logs", "app"]);
  throw new Error(`Timed out waiting for ${url}/healthz`);
}

async function cleanupAndExit(signal: string, code: number) {
  if (shuttingDown) process.exit(code);
  shuttingDown = true;
  console.log(`Received ${signal}; stopping E2E services.`);
  if (stopComposeOnSignal) await composeDown();
  process.exit(code);
}

process.on("SIGINT", () => {
  void cleanupAndExit("SIGINT", 130);
});

process.on("SIGTERM", () => {
  void cleanupAndExit("SIGTERM", 143);
});

let exitCode = 0;

try {
  if (suiteName === "start") {
    stopComposeOnSignal = true;
    await composeStart();
    stopComposeOnSignal = false;
  } else if (suiteName === "down") {
    await composeDown();
  } else {
    if (!selectedSpecs) throw new Error(`Unknown E2E suite "${suiteName}".`);
    if (!externalServerUrl) {
      stopComposeOnSignal = true;
      stopComposeOnExit = true;
      await composeStart();
    }

    await run(
      ["bunx", "playwright", "test", ...selectedSpecs, "--workers=1"],
      {
        ...process.env,
        OPENDROP_E2E_SERVER_URL: serverUrl,
        OPENDROP_E2E_SKIP_WEB_SERVER: "true"
      }
    );
  }
} catch (error) {
  exitCode = typeof (error as { code?: unknown }).code === "number" ? ((error as { code: number }).code) : 1;
} finally {
  if (stopComposeOnExit) await composeDown();
}

process.exit(exitCode);
