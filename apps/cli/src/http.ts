import { resolveServer, resolveToken } from "@/config";

export async function apiFetchRaw(path: string, init: RequestInit & { server?: string; token?: string } = {}) {
  const server = await resolveServer(init.server);
  const token = init.token || (await resolveToken());
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${server}${path}`, { ...init, headers });
  return response;
}

export async function apiFetch(path: string, init: RequestInit & { server?: string; token?: string } = {}) {
  const response = await apiFetchRaw(path, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${body}`);
  }
  return response;
}
