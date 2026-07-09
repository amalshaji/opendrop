import { useState } from "react";
import type { CliConnection, NamespaceAccess, NamespaceMember, SettingsTab } from "@/app/types";

interface UseSettingsWorkspaceOptions {
  setStatus: (status: string) => void;
}

export function useSettingsWorkspace({ setStatus }: UseSettingsWorkspaceOptions) {
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("namespaces");
  const [connections, setConnections] = useState<CliConnection[]>([]);
  const [namespaces, setNamespaces] = useState<NamespaceAccess[]>([]);
  const [namespaceMembers, setNamespaceMembers] = useState<Record<string, NamespaceMember[]>>({});
  const [newNamespace, setNewNamespace] = useState("");
  const [publisherDrafts, setPublisherDrafts] = useState<Record<string, string>>({});

  async function loadConnections() {
    const response = await fetch("/api/cli/connections", { credentials: "include" });
    if (response.ok) {
      const result = await response.json();
      setConnections(((result.connections || []) as CliConnection[]).filter((connection) => connection.label !== "dev-browser-session"));
    }
  }

  async function revokeConnection(id: string) {
    await fetch(`/api/cli/connections/${id}/revoke`, { method: "POST", credentials: "include" });
    await loadConnections();
  }

  async function loadSettings() {
    await Promise.all([loadConnections(), loadNamespaces()]);
  }

  async function showConnections() {
    setSettingsTab("connections");
    await loadConnections();
  }

  async function loadNamespaces() {
    const response = await fetch("/api/namespaces", { credentials: "include" });
    if (!response.ok) return;
    const result = await response.json();
    const list = (result.namespaces || []) as NamespaceAccess[];
    setNamespaces(list);
    const owned = list.filter((item) => item.role === "owner");
    const entries = await Promise.all(
      owned.map(async (item) => {
        const memberResponse = await fetch(`/api/namespaces/${item.name}/members`, { credentials: "include" });
        if (!memberResponse.ok) return [item.name, []] as const;
        const memberResult = await memberResponse.json();
        return [item.name, (memberResult.members || []) as NamespaceMember[]] as const;
      })
    );
    setNamespaceMembers(Object.fromEntries(entries));
  }

  async function createCustomNamespace() {
    const name = newNamespace.trim();
    if (!name) return;
    const response = await fetch("/api/namespaces", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setStatus(result.error || "Namespace could not be created.");
      return;
    }
    setNewNamespace("");
    setStatus(`Namespace /${result.namespace.name} created.`);
    await loadNamespaces();
    return result.namespace.name as string;
  }

  async function addPublisher(namespaceName: string) {
    const email = publisherDrafts[namespaceName]?.trim();
    if (!email) return;
    const response = await fetch(`/api/namespaces/${namespaceName}/publishers`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setStatus(
        result.error === "User not found."
          ? "No OpenDrop user has that email yet. Ask them to sign in once, then add them as a publisher."
          : result.error || "Publisher could not be added."
      );
      return;
    }
    setPublisherDrafts((current) => ({ ...current, [namespaceName]: "" }));
    setStatus(`${result.member.email} can publish to /${namespaceName}.`);
    await loadNamespaces();
  }

  async function removePublisher(namespaceName: string, userId: string) {
    const response = await fetch(`/api/namespaces/${namespaceName}/publishers/${userId}`, {
      method: "DELETE",
      credentials: "include"
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setStatus(result.error || "Publisher could not be removed.");
      return;
    }
    setStatus(`Publisher access removed from /${namespaceName}.`);
    await loadNamespaces();
  }

  return {
    settingsTab,
    setSettingsTab,
    connections,
    namespaces,
    namespaceMembers,
    newNamespace,
    setNewNamespace,
    publisherDrafts,
    setPublisherDrafts,
    loadConnections,
    revokeConnection,
    loadSettings,
    showConnections,
    loadNamespaces,
    createCustomNamespace,
    addPublisher,
    removePublisher
  };
}
