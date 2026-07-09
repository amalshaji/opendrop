import { z } from "zod";
import { visibilitySchema, type Visibility } from "../core";

export type AuthMode = "oauth" | "trusted-header" | "dev";
export const oauthProviderSchema = z.enum(["github", "google"]);
export type OAuthProvider = z.infer<typeof oauthProviderSchema>;

export interface TrustedHeaderConfig {
  trustedProxyCidrs: string[];
  trustedProxyHosts: string[];
  emailHeader: string;
  userIdHeader?: string;
  nameHeader?: string;
  avatarHeader?: string;
  loginUrl?: string;
  autoProvision: boolean;
  allowEmailLinking: boolean;
}

export interface OpenDropAuthConfig {
  authMode: AuthMode;
  allowedEmailDomains: string[];
  defaultVisibility: Visibility;
  oauthProviders: OAuthProvider[];
  trustedHeader?: TrustedHeaderConfig;
}

function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

const authModeSchema = z.enum(["oauth", "trusted-header", "dev"]);
const csvEnvSchema = z.string().optional().transform(csv);
const optionalLowerHeaderSchema = z
  .string()
  .min(1)
  .optional()
  .transform((value) => value?.toLowerCase());
const envBooleanSchema = (defaultValue: boolean) =>
  z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? defaultValue : value === "true"));

const authEnvSchema = z.object({
  OPENDROP_AUTH_MODE: authModeSchema.optional().default("trusted-header"),
  OPENDROP_ALLOWED_EMAIL_DOMAINS: csvEnvSchema.transform((domains) => domains.map((domain) => domain.toLowerCase())),
  OPENDROP_DEFAULT_VISIBILITY: visibilitySchema.optional().default("public"),
  TRUSTED_PROXY_CIDRS: csvEnvSchema.transform((cidrs) => (cidrs.length > 0 ? cidrs : ["127.0.0.1/32", "::1/128"])),
  TRUSTED_PROXY_HOSTS: csvEnvSchema.transform((hosts) => hosts.map((host) => host.toLowerCase())),
  TRUSTED_HEADER_EMAIL: z.string().min(1).optional().default("x-opendrop-email").transform((value) => value.toLowerCase()),
  TRUSTED_HEADER_USER_ID: optionalLowerHeaderSchema,
  TRUSTED_HEADER_NAME: optionalLowerHeaderSchema,
  TRUSTED_HEADER_AVATAR: optionalLowerHeaderSchema,
  TRUSTED_HEADER_LOGIN_URL: z.string().url().optional(),
  TRUSTED_HEADER_AUTO_PROVISION: envBooleanSchema(true),
  TRUSTED_HEADER_ALLOW_EMAIL_LINKING: envBooleanSchema(false)
});

const normalizedEmailSchema = z.string().trim().toLowerCase().email();

export function loadAuthConfig(env: Record<string, string | undefined>): OpenDropAuthConfig {
  const parsed = authEnvSchema.parse(env);
  return {
    authMode: parsed.OPENDROP_AUTH_MODE,
    allowedEmailDomains: parsed.OPENDROP_ALLOWED_EMAIL_DOMAINS,
    defaultVisibility: parsed.OPENDROP_DEFAULT_VISIBILITY,
    oauthProviders: configuredOAuthProviders(env),
    trustedHeader: {
      trustedProxyCidrs: parsed.TRUSTED_PROXY_CIDRS,
      trustedProxyHosts: parsed.TRUSTED_PROXY_HOSTS,
      emailHeader: parsed.TRUSTED_HEADER_EMAIL,
      userIdHeader: parsed.TRUSTED_HEADER_USER_ID,
      nameHeader: parsed.TRUSTED_HEADER_NAME,
      avatarHeader: parsed.TRUSTED_HEADER_AVATAR,
      loginUrl: parsed.TRUSTED_HEADER_LOGIN_URL,
      autoProvision: parsed.TRUSTED_HEADER_AUTO_PROVISION,
      allowEmailLinking: parsed.TRUSTED_HEADER_ALLOW_EMAIL_LINKING
    }
  };
}

export function configuredOAuthProviders(env: Record<string, string | undefined>): OAuthProvider[] {
  const providers: OAuthProvider[] = [];
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) providers.push("github");
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) providers.push("google");
  return providers;
}

export function emailAllowed(email: string, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return true;
  const domain = email.toLowerCase().split("@")[1];
  return Boolean(domain && allowedDomains.includes(domain));
}

export function normalizeEmail(email: string): string | null {
  const parsed = normalizedEmailSchema.safeParse(email);
  return parsed.success ? parsed.data : null;
}
