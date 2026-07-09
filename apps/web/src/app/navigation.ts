export function currentPathWithSearch(): string {
  return `${location.pathname}${location.search}` || "/";
}

export function currentSignInReturnTo(): string {
  const value = new URLSearchParams(location.search).get("returnTo");
  return safeReturnPath(value) ?? currentPathWithSearch();
}

export function signInUrl(returnTo = currentPathWithSearch()): string {
  const params = new URLSearchParams();
  const safeReturnTo = safeReturnPath(returnTo);
  if (safeReturnTo && safeReturnTo !== "/") params.set("returnTo", safeReturnTo);
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

export function trustedLoginUrl(loginUrl: string, returnTo: string): string {
  const url = new URL(loginUrl, location.origin);
  const safeReturnTo = safeReturnPath(returnTo);
  if (safeReturnTo) url.searchParams.set("returnTo", safeReturnTo);
  return url.toString();
}

function safeReturnPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}
