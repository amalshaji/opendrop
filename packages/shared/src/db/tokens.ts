import { randomId } from "../core";

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createRawCliToken(): string {
  return `od_${randomId("").repeat(2).slice(0, 40)}`;
}

export function createRawDeviceCode(): string {
  return `od_device_${randomId("").repeat(3).slice(0, 48)}`;
}

export function createUserCode(): string {
  const raw = randomId("").slice(0, 8).toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}
