import { expect, test } from "@playwright/test";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const serverUrl = process.env.OPENDROP_E2E_SERVER_URL || "http://127.0.0.1:43300";
const cliArgs = (...args: string[]) => ["run", "--cwd", "apps/cli", "dev", "--", ...args];

test("cli uploads and fetches a page", async ({ request }) => {
  const slug = `cli-e2e-${Date.now()}`;
  const preflight = await request.get(`${serverUrl}/__dev/preflight`);
  expect(preflight.ok()).toBe(true);

  const login = await request.post(`${serverUrl}/api/dev/login`, {
    data: { email: "cli@example.com", name: "CLI User" }
  });
  const { token } = await login.json();
  const publisherEmail = `publisher-cli-${Date.now()}@example.com`;
  const publisherLogin = await request.post(`${serverUrl}/api/dev/login`, {
    data: { email: publisherEmail, name: "Publisher CLI User" }
  });
  const { token: publisherToken } = await publisherLogin.json();

  const env = {
    ...process.env,
    OPENDROP_SERVER: serverUrl,
    OPENDROP_TOKEN: token
  };
  const site = resolve("tests/e2e/fixtures/valid-site");
  const whoami = await exec("bun", cliArgs("whoami", "--server", serverUrl), { env });
  expect(whoami.stdout).toContain("\"email\": \"cli@example.com\"");

  const sharedNamespace = `shared-cli-${Date.now()}`;
  const namespaceCreate = await exec("bun", cliArgs("namespaces", "create", sharedNamespace, "--server", serverUrl), { env });
  expect(namespaceCreate.stdout).toContain(`"name": "${sharedNamespace}"`);
  const namespaceList = await exec("bun", cliArgs("namespaces", "list", "--server", serverUrl), { env });
  expect(namespaceList.stdout).toContain(sharedNamespace);
  const addPublisher = await exec("bun", cliArgs("namespaces", "add-publisher", sharedNamespace, publisherEmail, "--server", serverUrl), { env });
  expect(addPublisher.stdout).toContain(`"email": "${publisherEmail}"`);
  const members = await exec("bun", cliArgs("namespaces", "members", sharedNamespace, "--server", serverUrl), { env });
  expect(members.stdout).toContain(publisherEmail);

  const publisherEnv = { ...env, OPENDROP_TOKEN: publisherToken };
  const sharedSlug = `shared-${slug}`;
  const publisherUpload = await exec("bun", cliArgs("upload", site, "--namespace", sharedNamespace, "--slug", sharedSlug, "--json"), { env: publisherEnv });
  expect(publisherUpload.stdout).toContain(`"namespace": "${sharedNamespace}"`);
  const ownerReplacement = await execAllowFailure("bun", cliArgs("upload", site, "--namespace", sharedNamespace, "--slug", sharedSlug, "--json"), { env });
  expect(ownerReplacement.code).not.toBe(0);
  expect(`${ownerReplacement.stdout}${ownerReplacement.stderr}`).toContain("Only the slug owner can create a new version.");

  const upload = await exec("bun", cliArgs("upload", site, "--slug", slug, "--json"), { env });
  expect(upload.stdout).toContain(`"slug": "${slug}"`);
  const uploadResult = JSON.parse(upload.stdout);

  const publicOutput = await exec("bun", cliArgs("upload", site, "--slug", `${slug}-public-url`), {
    env: { ...env, OPENDROP_DEPLOYMENT_URL: "https://drops.example.test" }
  });
  expect(publicOutput.stdout).toContain(`https://drops.example.test/cli/${slug}-public-url`);
  expect(publicOutput.stdout).not.toContain(`${serverUrl}/cli/${slug}-public-url`);

  const privateSlug = `${slug}-private`;
  const privateUpload = await exec("bun", cliArgs("upload", site, "--slug", privateSlug, "--visibility", "private", "--json"), { env });
  expect(privateUpload.stdout).toContain("\"visibility\": \"private\"");
  const anonymousPrivate = await fetch(`${serverUrl}/cli/${privateSlug}`);
  expect(anonymousPrivate.status).toBe(401);

  const fetched = await exec("bun", cliArgs("fetch", `cli/${slug}`, "--server", serverUrl), { env });
  expect(fetched.stdout).toContain("Fixture published");
  const fetchedByVersionUrl = await exec("bun", cliArgs("fetch", `${serverUrl}/cli/${slug}/versions/${uploadResult.version.id}`, "--server", serverUrl), {
    env
  });
  expect(fetchedByVersionUrl.stdout).toContain("Fixture published");

  const versions = await exec("bun", cliArgs("versions", `cli/${slug}`, "--server", serverUrl), { env });
  expect(versions.stdout).toContain(uploadResult.version.id);

  const versionTarget = `${serverUrl}/cli/${slug}/versions/${uploadResult.version.id}`;
  const added = await exec("bun", cliArgs("annotation", "add", versionTarget, "--server", serverUrl, "--body", "CLI-visible annotation", "--tag", "cli", "--tag", "agent"), {
    env
  });
  const addedResult = JSON.parse(added.stdout);
  expect(addedResult.annotation).toMatchObject({
    versionId: uploadResult.version.id,
    pagePath: "/",
    body: "CLI-visible annotation",
    tags: ["cli", "agent"],
    shape: { type: "note", x: 0.5, y: 0.5 }
  });

  const reply = await exec(
    "bun",
    cliArgs("annotation", "reply", versionTarget, addedResult.annotation.id, "--server", serverUrl, "--body", "CLI reply"),
    { env }
  );
  const replyResult = JSON.parse(reply.stdout);
  expect(replyResult.annotation).toMatchObject({
    versionId: uploadResult.version.id,
    pagePath: "/",
    parentAnnotationId: addedResult.annotation.id,
    body: "CLI reply",
    shape: addedResult.annotation.shape,
    viewport: addedResult.annotation.viewport
  });

  const resolved = await exec("bun", cliArgs("annotation", "resolve", `cli/${slug}`, addedResult.annotation.id, "--server", serverUrl), { env });
  expect(JSON.parse(resolved.stdout).annotation.resolvedAt).not.toBeNull();
  const reopened = await exec("bun", cliArgs("annotation", "reopen", `cli/${slug}`, addedResult.annotation.id, "--server", serverUrl), { env });
  expect(JSON.parse(reopened.stdout).annotation.resolvedAt).toBeNull();

  const annotations = await exec("bun", cliArgs("annotations", `cli/${slug}`, "--server", serverUrl, "--version-id", uploadResult.version.id), { env });
  expect(annotations.stdout).toContain("CLI-visible annotation");
  expect(annotations.stdout).toContain("CLI reply");
  const annotationsByVersionUrl = await exec("bun", cliArgs("annotations", `${serverUrl}/cli/${slug}/versions/${uploadResult.version.id}`, "--server", serverUrl), {
    env
  });
  expect(annotationsByVersionUrl.stdout).toContain("CLI-visible annotation");
  const fetchedAnnotations = await exec("bun", cliArgs("fetch", versionTarget, "--server", serverUrl, "--include", "annotations"), { env });
  const fetchedAnnotationList = JSON.parse(fetchedAnnotations.stdout).annotations;
  expect(fetchedAnnotationList).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: addedResult.annotation.id, resolvedAt: null }),
      expect.objectContaining({ id: replyResult.annotation.id, parentAnnotationId: addedResult.annotation.id })
    ])
  );
});

test("cli login completes device flow and stores local config", async ({ request }) => {
  const preflight = await request.get(`${serverUrl}/__dev/preflight`);
  expect(preflight.ok()).toBe(true);

  const login = await request.post(`${serverUrl}/api/dev/login`, {
    data: { email: "device-cli@example.com", name: "Device CLI User" }
  });
  const { token } = await login.json();
  const home = await mkdtemp(join(tmpdir(), "opendrop-cli-"));
  const env = { ...process.env, HOME: home };
  const child = spawn("bun", cliArgs("login", "--server", serverUrl, "--no-open"), { env });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    const userCode = await waitForMatch(() => stdout.match(/Code:\s*([A-Z0-9-]+)/)?.[1]);
    const approve = await request.post(`${serverUrl}/api/device/approve`, {
      headers: { authorization: `Bearer ${token}` },
      data: { userCode, decision: "approve" }
    });
    expect(approve.ok()).toBe(true);

    const code = await new Promise<number | null>((resolveExit, reject) => {
      child.once("error", reject);
      child.once("exit", resolveExit);
    });
    expect(code, stderr).toBe(0);
    expect(stdout).toContain(`Logged in to ${serverUrl}`);
    const config = JSON.parse(await readFile(join(home, ".opendrop", "config.json"), "utf8"));
    expect(config.server).toBe(serverUrl);
    expect(config.token).toMatch(/^od_/);

    const whoami = await exec("bun", cliArgs("whoami"), { env });
    expect(whoami.stdout).toContain("\"email\": \"device-cli@example.com\"");
  } finally {
    if (child.exitCode === null) child.kill();
  }
});

async function waitForMatch<T>(read: () => T | undefined): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for CLI output.");
}

async function execAllowFailure(
  file: string,
  args: string[],
  options: Parameters<typeof exec>[2]
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  try {
    const result = await exec(file, args, options);
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? 1, stdout: failed.stdout ?? "", stderr: failed.stderr ?? "" };
  }
}
