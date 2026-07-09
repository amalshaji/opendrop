import { useEffect, useState } from "react";
import { displayNameFromEmail } from "@/app/format";
import { currentPathWithSearch, currentSignInReturnTo, signInUrl } from "@/app/navigation";
import type { Session } from "@/app/types";

interface UseAuthSessionOptions {
  setStatus: (status: string) => void;
  onLogout: () => void;
}

export function useAuthSession({ setStatus, onLogout }: UseAuthSessionOptions) {
  const [session, setSession] = useState<Session | null>(null);
  const [devAuthEmail, setDevAuthEmail] = useState("");

  useEffect(() => {
    void refreshSession();
  }, []);

  async function refreshSession() {
    const response = await fetch("/api/session", { credentials: "include" });
    setSession(await response.json());
  }

  async function devLogin(email = devAuthEmail) {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setStatus("Enter an email to continue.");
      return;
    }
    setStatus("Signing in with Dev Auth...");
    const response = await fetch("/api/dev/login", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: normalizedEmail, name: displayNameFromEmail(normalizedEmail) })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setStatus(result.error || "Dev Auth failed.");
      return;
    }
    const returnTo = currentSignInReturnTo();
    await refreshSession();
    if (returnTo !== currentPathWithSearch()) {
      location.href = returnTo;
      return;
    }
    setStatus("Signed in.");
  }

  async function startOAuth(provider: "github" | "google") {
    setStatus(`Starting ${provider} sign in...`);
    const returnTo = currentSignInReturnTo();
    const response = await fetch("/api/auth/sign-in/social", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider,
        callbackURL: returnTo,
        errorCallbackURL: signInUrl(returnTo),
        disableRedirect: true
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.url) {
      setStatus(result.message || result.error || "OAuth sign in could not start.");
      return;
    }
    location.href = result.url;
  }

  async function logout() {
    setStatus("Signing out...");
    await fetch("/__dev/log-me-out?returnTo=/", { credentials: "include" }).catch(() => null);
    await fetch("/api/auth/sign-out", { method: "POST", credentials: "include" }).catch(() => null);
    setSession(null);
    onLogout();
    location.href = "/";
  }

  return {
    session,
    devAuthEmail,
    setDevAuthEmail,
    devLogin,
    startOAuth,
    logout,
    refreshSession
  };
}
