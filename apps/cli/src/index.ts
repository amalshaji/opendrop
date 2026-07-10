#!/usr/bin/env node
import { Command } from "commander";
import { spawn } from "node:child_process";
import { hostname } from "node:os";
import {
  deploymentRefInputSchema,
  deviceCodeResponseSchema,
  deviceCodeBodySchema,
  deviceTokenBodySchema,
  deviceTokenResponseSchema,
  fetchIncludeSchema,
  namespaceCreateBodySchema,
  namespacePublisherBodySchema,
  namespacePublisherRouteParamsSchema,
  namespaceRouteParamsSchema,
  pageQuerySchema,
  uploadMetadataSchema
} from "@opendrop/shared/core";
import { z } from "zod";
import { readCliConfig, resolveDeploymentUrl, resolveServer, setConfigValue, writeCliConfig } from "@/config";
import { parseDeploymentTarget, searchParams, validationMessage } from "@/command-helpers";
import { registerAnnotationCommands } from "@/commands/annotation";
import { collectUploadFiles } from "@/files";
import { apiFetch } from "@/http";
import { publishDirectUpload } from "@/upload-session";

const program = new Command();
const loginOptionsSchema = z.object({
  server: z.string().url().optional(),
  token: z.string().min(1).optional(),
  open: z.boolean().default(true)
});
const serverOptionSchema = z.object({
  server: z.string().url().optional()
});
const uploadOptionsSchema = serverOptionSchema.extend({
  namespace: z.string().optional(),
  slug: z.string().optional(),
  visibility: z.string().optional(),
  json: z.boolean().default(false)
});
const fetchOptionsSchema = serverOptionSchema.extend({
  path: z.string().min(1).default("/"),
  versionId: z.string().optional(),
  include: z.string().default("html,annotations")
});
const configCommandSchema = z
  .object({
    action: z.enum(["get", "set"]),
    key: z.string().optional(),
    value: z.string().optional()
  })
  .superRefine((input, ctx) => {
    if (input.action === "set" && (!input.key || !input.value)) {
      ctx.addIssue({
        code: "custom",
        message: "Usage: opendrop config set server-url <url>",
        path: ["value"]
      });
    }
  });
const uploadPathSchema = z.string().min(1, "Upload path is required.");

program.name("opendrop").description("Publish and review OpenDrop static previews").version("0.2.0");

program
  .command("config")
  .description("Read or update local OpenDrop CLI config")
  .argument("<action>", "get or set")
  .argument("[key]", "server-url, deployment-url, or token")
  .argument("[value]", "value to store")
  .action(async (action, key, value) => {
    const parsed = configCommandSchema.safeParse({ action, key, value });
    if (!parsed.success) throw new Error(validationMessage(parsed.error));
    if (parsed.data.action === "get") {
      console.log(JSON.stringify(await readCliConfig(), null, 2));
      return;
    }
    console.log(JSON.stringify(await setConfigValue(parsed.data.key!, parsed.data.value!), null, 2));
  });

program
  .command("login")
  .description("Authenticate with OpenDrop using device login")
  .option("--server <url>", "OpenDrop server URL")
  .option("--token <token>", "CLI token minted from the web UI")
  .option("--no-open", "Do not try to open the browser")
  .action(async (options) => {
    const parsedOptions = loginOptionsSchema.safeParse(options);
    if (!parsedOptions.success) throw new Error(validationMessage(parsedOptions.error));
    const server = await resolveServer(parsedOptions.data.server);
    if (parsedOptions.data.token || process.env.OPENDROP_TOKEN) {
      const token = parsedOptions.data.token || process.env.OPENDROP_TOKEN;
      await writeCliConfig({ ...(await readCliConfig()), server, token });
      console.log(`Logged in to ${server}`);
      return;
    }

    const body = deviceCodeBodySchema.parse({ label: "OpenDrop CLI", deviceName: hostname() });
    const response = await fetch(`${server}/api/device/code`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(await response.text());
    const device = deviceCodeResponseSchema.parse(await response.json());
    console.log(`Open this URL to approve login:\n${device.verificationUriComplete}`);
    console.log(`Code: ${device.userCode}`);
    if (parsedOptions.data.open) openBrowser(device.verificationUriComplete);

    const token = await pollForDeviceToken(server, device.deviceCode, device.interval);
    await writeCliConfig({ ...(await readCliConfig()), server, token });
    console.log(`Logged in to ${server}`);
  });

program
  .command("whoami")
  .description("Show the current authenticated user")
  .option("--server <url>", "OpenDrop server URL")
  .action(async (options) => {
    const parsedOptions = serverOptionSchema.safeParse(options);
    if (!parsedOptions.success) throw new Error(validationMessage(parsedOptions.error));
    const response = await apiFetch("/api/cli/whoami", { server: parsedOptions.data.server });
    console.log(JSON.stringify(await response.json(), null, 2));
  });

const namespacesCommand = program.command("namespaces").description("Manage namespaces and publisher access");

namespacesCommand
  .command("list")
  .description("List namespaces you own or can publish to")
  .option("--server <url>", "OpenDrop server URL")
  .action(async (options) => {
    const parsedOptions = serverOptionSchema.safeParse(options);
    if (!parsedOptions.success) throw new Error(validationMessage(parsedOptions.error));
    const response = await apiFetch("/api/namespaces", { server: parsedOptions.data.server });
    console.log(JSON.stringify(await response.json(), null, 2));
  });

namespacesCommand
  .command("create")
  .description("Create a custom namespace")
  .argument("<name>", "Namespace name")
  .option("--server <url>", "OpenDrop server URL")
  .action(async (name, options) => {
    const parsedOptions = serverOptionSchema.safeParse(options);
    if (!parsedOptions.success) throw new Error(validationMessage(parsedOptions.error));
    const body = namespaceCreateBodySchema.safeParse({ name });
    if (!body.success) throw new Error(validationMessage(body.error));
    const response = await apiFetch("/api/namespaces", {
      server: parsedOptions.data.server,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body.data)
    });
    console.log(JSON.stringify(await response.json(), null, 2));
  });

namespacesCommand
  .command("members")
  .description("List namespace members")
  .argument("<namespace>", "Namespace name")
  .option("--server <url>", "OpenDrop server URL")
  .action(async (namespace, options) => {
    const parsedOptions = serverOptionSchema.safeParse(options);
    if (!parsedOptions.success) throw new Error(validationMessage(parsedOptions.error));
    const params = namespaceRouteParamsSchema.safeParse({ namespace });
    if (!params.success) throw new Error(validationMessage(params.error));
    const response = await apiFetch(`/api/namespaces/${params.data.namespace}/members`, { server: parsedOptions.data.server });
    console.log(JSON.stringify(await response.json(), null, 2));
  });

namespacesCommand
  .command("add-publisher")
  .description("Grant publish access to an existing user")
  .argument("<namespace>", "Namespace name")
  .argument("<email>", "User email")
  .option("--server <url>", "OpenDrop server URL")
  .action(async (namespace, email, options) => {
    const parsedOptions = serverOptionSchema.safeParse(options);
    if (!parsedOptions.success) throw new Error(validationMessage(parsedOptions.error));
    const params = namespaceRouteParamsSchema.safeParse({ namespace });
    if (!params.success) throw new Error(validationMessage(params.error));
    const body = namespacePublisherBodySchema.safeParse({ email });
    if (!body.success) throw new Error(validationMessage(body.error));
    const response = await apiFetch(`/api/namespaces/${params.data.namespace}/publishers`, {
      server: parsedOptions.data.server,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body.data)
    });
    console.log(JSON.stringify(await response.json(), null, 2));
  });

namespacesCommand
  .command("remove-publisher")
  .description("Revoke publish access from a namespace")
  .argument("<namespace>", "Namespace name")
  .argument("<userId>", "User id")
  .option("--server <url>", "OpenDrop server URL")
  .action(async (namespace, userId, options) => {
    const parsedOptions = serverOptionSchema.safeParse(options);
    if (!parsedOptions.success) throw new Error(validationMessage(parsedOptions.error));
    const params = namespacePublisherRouteParamsSchema.safeParse({ namespace, userId });
    if (!params.success) throw new Error(validationMessage(params.error));
    const response = await apiFetch(`/api/namespaces/${params.data.namespace}/publishers/${params.data.userId}`, {
      server: parsedOptions.data.server,
      method: "DELETE"
    });
    console.log(JSON.stringify(await response.json(), null, 2));
  });

program
  .command("upload")
  .argument("<path>", "Folder or zip to upload")
  .option("--server <url>", "OpenDrop server URL")
  .option("--namespace <namespace>", "Namespace to publish under")
  .option("--slug <slug>", "Slug to publish under")
  .option("--visibility <visibility>", "public or private")
  .option("--json", "Print JSON response")
  .action(async (inputPath, options) => {
    const parsedOptions = uploadOptionsSchema.safeParse(options);
    if (!parsedOptions.success) throw new Error(validationMessage(parsedOptions.error));
    const parsedPath = uploadPathSchema.safeParse(inputPath);
    if (!parsedPath.success) throw new Error(validationMessage(parsedPath.error));
    const metadata = uploadMetadataSchema.safeParse({
      namespace: parsedOptions.data.namespace,
      slug: parsedOptions.data.slug,
      visibility: parsedOptions.data.visibility
    });
    if (!metadata.success) throw new Error(validationMessage(metadata.error));
    const files = await collectUploadFiles(parsedPath.data);
    const direct = await publishDirectUpload(files, metadata.data, parsedOptions.data.server);
    const result = direct.kind === "published"
      ? direct.result
      : await publishMultipart(files, metadata.data, parsedOptions.data.server);
    if (parsedOptions.data.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      const server = await resolveServer(parsedOptions.data.server);
      const deploymentUrl = await resolveDeploymentUrl(server);
      console.log(`${deploymentUrl}${result.url}`);
      console.log(`${deploymentUrl}${result.versionUrl}`);
    }
  });

program
  .command("versions")
  .argument("<ref>", "namespace/slug")
  .option("--server <url>", "OpenDrop server URL")
  .action(async (ref, options) => {
    const parsedOptions = serverOptionSchema.safeParse(options);
    if (!parsedOptions.success) throw new Error(validationMessage(parsedOptions.error));
    const { namespace, slug } = parseDeploymentRef(ref);
    const response = await apiFetch(`/api/deployments/${namespace}/${slug}/versions`, { server: parsedOptions.data.server });
    console.log(JSON.stringify(await response.json(), null, 2));
  });

program
  .command("fetch")
  .argument("<url-or-ref>", "Preview URL or namespace/slug")
  .option("--server <url>", "OpenDrop server URL")
  .option("--path <path>", "Page path", "/")
  .option("--version-id <versionId>", "Version id")
  .option("--include <parts>", "html,manifest,annotations", "html,annotations")
  .action(async (target, options) => {
    const parsedOptions = fetchOptionsSchema.safeParse(options);
    if (!parsedOptions.success) throw new Error(validationMessage(parsedOptions.error));
    const { namespace, slug, versionId } = parseDeploymentTarget(target);
    const query = pageQuerySchema.safeParse({ path: parsedOptions.data.path, versionId: parsedOptions.data.versionId ?? versionId });
    if (!query.success) throw new Error(validationMessage(query.error));
    const include = parseInclude(parsedOptions.data.include);
    const params = searchParams(query.data);
    const response = await apiFetch(`/api/deployments/${namespace}/${slug}/page?${params}`, { server: parsedOptions.data.server });
    const result = await response.json();
    const output: Record<string, unknown> = {};
    if (include.includes("html")) output.html = result.html;
    if (include.includes("annotations")) output.annotations = result.annotations;
    if (include.includes("manifest")) output.deployment = result.deployment;
    console.log(JSON.stringify(output, null, 2));
  });

registerAnnotationCommands(program);

program.parseAsync().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

async function pollForDeviceToken(server: string, deviceCode: string, intervalSeconds: number): Promise<string> {
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
    const response = await fetch(`${server}/api/device/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(deviceTokenBodySchema.parse({ deviceCode }))
    });
    if (response.status === 428) {
      process.stdout.write(".");
      continue;
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(typeof body === "object" && body !== null && "error" in body ? String(body.error) : "Device login failed.");
    }
    console.log("");
    return deviceTokenResponseSchema.parse(body).accessToken;
  }
}

function openBrowser(url: string) {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.unref();
}

function parseDeploymentRef(ref: string): { namespace: string; slug: string } {
  const parsed = deploymentRefInputSchema.safeParse(ref);
  if (!parsed.success) throw new Error("Expected namespace/slug. " + validationMessage(parsed.error));
  return parsed.data;
}

function parseInclude(value: unknown): Array<"html" | "manifest" | "annotations"> {
  const parsed = fetchIncludeSchema.safeParse(value);
  if (!parsed.success) throw new Error(validationMessage(parsed.error));
  return parsed.data;
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function publishMultipart(
  files: Awaited<ReturnType<typeof collectUploadFiles>>,
  metadata: { namespace?: string; slug?: string; visibility?: "public" | "private" },
  server?: string
) {
  const form = new FormData();
  for (const file of files) {
    form.append("files", new Blob([arrayBufferFromBytes(file.bytes)], { type: file.type }), file.path);
  }
  if (metadata.namespace) form.append("namespace", metadata.namespace);
  if (metadata.slug) form.append("slug", metadata.slug);
  if (metadata.visibility) form.append("visibility", metadata.visibility);
  const response = await apiFetch("/api/uploads/publish", { server, method: "POST", body: form });
  return response.json() as Promise<Record<string, unknown>>;
}
