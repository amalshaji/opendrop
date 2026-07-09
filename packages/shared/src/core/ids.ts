const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export function randomId(prefix = ""): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let value = "";
  for (const byte of bytes) {
    value += ALPHABET[byte % ALPHABET.length];
  }
  return `${prefix}${value}`;
}

export function randomSlug(): string {
  const adjective = ["amber", "brisk", "clear", "fresh", "kind", "lunar", "neat", "prime"];
  const noun = ["drop", "frame", "page", "pixel", "site", "view", "wave", "work"];
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return `${adjective[bytes[0] % adjective.length]}-${noun[bytes[1] % noun.length]}-${bytes[2].toString(36)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
