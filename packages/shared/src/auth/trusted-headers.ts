import { emailAllowed, normalizeEmail, type OpenDropAuthConfig } from "./config";

export interface TrustedHeaderIdentity {
  email: string;
  subject: string;
  name?: string | null;
  avatarUrl?: string | null;
}

export interface TrustedHeaderSource {
  ip: string | null;
  host?: string | null;
}

export function readTrustedHeaderIdentity(
  headers: Headers,
  source: string | TrustedHeaderSource | null,
  config: OpenDropAuthConfig
): { identity: TrustedHeaderIdentity | null; error?: string } {
  if (config.authMode !== "trusted-header" && config.authMode !== "dev") {
    return { identity: null };
  }
  const trusted = config.trustedHeader;
  if (!trusted) return { identity: null };
  const hasIdentityHeaders = [trusted.emailHeader, trusted.userIdHeader, trusted.nameHeader, trusted.avatarHeader].some(
    (header) => header && headers.has(header)
  );
  if (!isTrustedSource(source, trusted.trustedProxyCidrs, trusted.trustedProxyHosts)) {
    return hasIdentityHeaders ? { identity: null, error: "Identity headers were sent from an untrusted source." } : { identity: null };
  }

  const email = normalizeEmail(headers.get(trusted.emailHeader) ?? "");
  if (!email) return { identity: null };
  if (!emailAllowed(email, config.allowedEmailDomains)) {
    return { identity: null, error: "Email domain is not allowed." };
  }

  const configuredSubject = trusted.userIdHeader ? headers.get(trusted.userIdHeader) : null;
  const subject = (configuredSubject || email).trim();
  if (!subject) return { identity: null, error: "Trusted identity subject is empty." };

  return {
    identity: {
      email,
      subject,
      name: trusted.nameHeader ? headers.get(trusted.nameHeader) : null,
      avatarUrl: trusted.avatarHeader ? headers.get(trusted.avatarHeader) : null
    }
  };
}

export function isTrustedSource(source: string | TrustedHeaderSource | null, cidrs: string[], hosts: string[] = []): boolean {
  const normalized = typeof source === "string" ? { ip: source, host: null } : source;
  if (!normalized) return false;
  if (normalized.ip && isTrustedSourceIp(normalized.ip, cidrs)) return true;
  const host = normalized.host?.toLowerCase();
  return Boolean(host && hosts.includes(host));
}

export function isTrustedSourceIp(sourceIp: string, cidrs: string[]): boolean {
  const ip = sourceIp.replace(/^::ffff:/, "");
  return cidrs.some((cidr) => {
    if (cidr === ip) return true;
    const [range, bits] = cidr.split("/");
    if (!bits) return range === ip;
    if (ip.includes(":") || range.includes(":")) {
      return bits === "128" && range === sourceIp;
    }
    return ipv4InCidr(ip, range, Number(bits));
  });
}

function ipv4InCidr(ip: string, range: string, bits: number): boolean {
  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(range);
  if (ipInt === null || rangeInt === null || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}
