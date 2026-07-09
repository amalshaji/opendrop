import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { z } from "zod";

export interface CliConfig {
  server?: string;
  deploymentUrl?: string;
  token?: string;
}

const configPath = join(homedir(), ".opendrop", "config.json");
const urlSchema = z
  .string()
  .url()
  .transform((value) => value.replace(/\/+$/, ""));
const cliConfigSchema = z.object({
  server: urlSchema.optional(),
  deploymentUrl: urlSchema.optional(),
  token: z.string().min(1).optional()
});
const configKeySchema = z.enum(["server", "server-url", "base-url", "deployment-url", "deploy-url", "token"]);

export async function readCliConfig(): Promise<CliConfig> {
  try {
    const parsed = cliConfigSchema.safeParse(JSON.parse(await readFile(configPath, "utf8")));
    if (!parsed.success) throw new Error("Invalid OpenDrop CLI config.");
    return parsed.data;
  } catch {
    return {};
  }
}

export async function writeCliConfig(config: CliConfig): Promise<void> {
  const parsed = cliConfigSchema.safeParse(config);
  if (!parsed.success) throw new Error(zodMessage(parsed.error));
  await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
  await writeFile(configPath, JSON.stringify(parsed.data, null, 2), { mode: 0o600 });
}

export async function resolveServer(explicit?: string): Promise<string> {
  const config = await readCliConfig();
  let server = explicit || config.server || process.env.OPENDROP_SERVER;
  if (!server && input.isTTY) {
    const rl = createInterface({ input, output });
    server = await rl.question("OpenDrop server URL: ");
    rl.close();
    if (server) {
      await writeCliConfig({ ...config, server });
    }
  }
  if (!server) throw new Error("Missing server. Pass --server or run opendrop login --server <url>.");
  const parsed = urlSchema.safeParse(server);
  if (!parsed.success) throw new Error(`Invalid server URL. ${zodMessage(parsed.error)}`);
  return parsed.data;
}

export async function resolveDeploymentUrl(server: string): Promise<string> {
  const config = await readCliConfig();
  const deploymentUrl = process.env.OPENDROP_DEPLOYMENT_URL || config.deploymentUrl || server;
  const parsed = urlSchema.safeParse(deploymentUrl);
  if (!parsed.success) throw new Error(`Invalid deployment URL. ${zodMessage(parsed.error)}`);
  return parsed.data;
}

export async function resolveToken(): Promise<string> {
  const config = await readCliConfig();
  const token = process.env.OPENDROP_TOKEN || config.token;
  if (!token) throw new Error("Auth is not done. Run npx opendrop login.");
  return token;
}

export async function setConfigValue(key: string, value: string): Promise<CliConfig> {
  const parsedKey = configKeySchema.safeParse(key);
  if (!parsedKey.success) throw new Error(`Unknown config key: ${key}`);
  const config = await readCliConfig();
  if (parsedKey.data === "server" || parsedKey.data === "server-url" || parsedKey.data === "base-url") {
    config.server = parseUrlValue(value);
  } else if (parsedKey.data === "deployment-url" || parsedKey.data === "deploy-url") {
    config.deploymentUrl = parseUrlValue(value);
  } else if (parsedKey.data === "token") {
    config.token = value;
  }
  await writeCliConfig(config);
  return config;
}

function parseUrlValue(value: string): string {
  const parsed = urlSchema.safeParse(value);
  if (!parsed.success) throw new Error(`Invalid URL. ${zodMessage(parsed.error)}`);
  return parsed.data;
}

function zodMessage(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`).join("; ");
}
