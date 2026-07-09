import "vite/modulepreload-polyfill";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  annotationInputSchema,
  deviceDecisionBodySchema,
  deviceRequestParamsSchema,
  uploadMetadataSchema,
  validationResultSchema,
  type AnnotationShape,
  type ValidationResult,
  type Visibility
} from "@opendrop/shared/core";
import {
  displayNameFromEmail,
  parsePreviewRoute,
  validationMessage
} from "@/app/format";
import {
  filesFromDataTransfer,
  uploadFormData,
  uploadPath
} from "@/app/upload-files";
import {
  currentPathWithSearch,
  currentSignInReturnTo,
  signInUrl
} from "@/app/navigation";
import { AuthLanding } from "@/app/auth-landing";
import { DashboardShell } from "@/app/dashboard-shell";
import { DeviceApprovalPanel } from "@/app/device-approval-panel";
import { PreviewLoading } from "@/app/preview-loading";
import { PreviewRoom } from "@/app/preview-room";
import { SettingsWorkspace } from "@/app/settings-workspace";
import { UploadWorkspace } from "@/app/upload-workspace";
import type {
  AnnotationMode,
  AnnotationRecord,
  CliConnection,
  DashboardView,
  DeploymentVersion,
  DeviceRequest,
  NamespaceAccess,
  NamespaceMember,
  PreviewRoute,
  PublishResult,
  Session,
  SettingsTab
} from "@/app/types";
import "./styles.css";

function App() {
  const previewRoute = useMemo(() => parsePreviewRoute(location.pathname, location.search), []);
  const [session, setSession] = useState<Session | null>(null);
  const [devAuthEmail, setDevAuthEmail] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploadDragging, setUploadDragging] = useState(false);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [namespace, setNamespace] = useState("");
  const [slug, setSlug] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [publish, setPublish] = useState<PublishResult | null>(null);
  const [lastPublished, setLastPublished] = useState<PublishResult | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [versions, setVersions] = useState<DeploymentVersion[]>([]);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [annotation, setAnnotation] = useState("");
  const [annotationMode, setAnnotationMode] = useState<AnnotationMode>("browse");
  const [draftShape, setDraftShape] = useState<AnnotationShape | null>(null);
  const [bridgeNonce, setBridgeNonce] = useState(0);
  const [annotations, setAnnotations] = useState<AnnotationRecord[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 721px)").matches
  );
  const [status, setStatus] = useState("");
  const [view, setView] = useState<DashboardView>(() => (location.pathname === "/device" ? "device" : "uploads"));
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("namespaces");
  const [connections, setConnections] = useState<CliConnection[]>([]);
  const [deviceCode] = useState(() => {
    const parsed = deviceRequestParamsSchema.safeParse({ userCode: new URLSearchParams(location.search).get("user_code") || "" });
    return parsed.success ? parsed.data.userCode : "";
  });
  const [deviceRequest, setDeviceRequest] = useState<DeviceRequest | null>(null);
  const [namespaces, setNamespaces] = useState<NamespaceAccess[]>([]);
  const [namespaceMembers, setNamespaceMembers] = useState<Record<string, NamespaceMember[]>>({});
  const [newNamespace, setNewNamespace] = useState("");
  const [publisherDrafts, setPublisherDrafts] = useState<Record<string, string>>({});
  const frameRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const zipInputRef = useRef<HTMLInputElement | null>(null);
  const routePreview = `/${namespace.trim() || session?.user?.defaultNamespace || "namespace"}/${slug.trim() || "random-slug"}`;
  const activeSidebarItem = view === "uploads" && (publish || previewRoute) ? "previews" : view;
  const pageTitle = previewRoute
    ? `/${previewRoute.namespace}/${previewRoute.slug}`
    : view === "settings"
      ? "Settings"
      : view === "device"
        ? "Approve CLI connection"
        : publish
          ? "Preview and annotate"
          : "Publish a static drop";
  const pageSubtitle = previewRoute
    ? "Review the live preview, versions, and annotations."
    : view === "settings"
      ? "Manage namespaces, publishers, and CLI connections."
      : view === "device"
        ? "Confirm the request opened by the CLI, then return to the terminal."
        : publish
          ? "Inspect the published preview, switch versions, and leave review notes."
          : "Upload a folder or zip, review validation, then share a versioned preview.";
  const statusLabel = status || (session ? "Idle" : "Checking session");
  const lastPublishedHref = lastPublished?.url || lastPublished?.versionUrl || "";
  const lastPublishedDisplayUrl = lastPublishedHref ? `${location.origin}${lastPublishedHref}` : "";
  const hasReviewWorkspace = Boolean(publish || previewRoute || lastPublished);

  useEffect(() => {
    refreshSession();
  }, []);

  useEffect(() => {
    if (session?.user) {
      setNamespace(session.user.defaultNamespace);
      setVisibility(session.defaultVisibility);
    }
  }, [session]);

  useEffect(() => {
    if (previewRoute) {
      loadSharedPreview(previewRoute);
    }
  }, [previewRoute?.namespace, previewRoute?.slug, previewRoute?.versionId, session?.authenticated]);

  useEffect(() => {
    if (publish && activeVersionId) {
      loadAnnotations(publish.namespace, publish.slug, activeVersionId);
    }
  }, [publish?.namespace, publish?.slug, activeVersionId]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (!data || data.source !== "opendrop-preview") return;
      if (data.type === "ready") {
        setBridgeNonce((value) => value + 1);
        return;
      }
      if (data.type === "point" && typeof data.x === "number" && typeof data.y === "number") {
        setDraftShape(data.shape && typeof data.shape === "object" ? data.shape as AnnotationShape : { type: "pin", x: data.x, y: data.y });
        setCommentsOpen(true);
        setStatus("Point marked. Add your comment.");
        return;
      }
      if (data.type === "selection" && Array.isArray(data.rects) && data.rects.length) {
        setDraftShape(data.shape && typeof data.shape === "object" ? data.shape as AnnotationShape : { type: "highlight", rects: data.rects, text: typeof data.text === "string" ? data.text : undefined });
        setCommentsOpen(true);
        setStatus("Text selected. Add your comment.");
        return;
      }
      if (data.type === "select" && typeof data.id === "string") {
        setSelectedAnnotationId(data.id);
        setCommentsOpen(true);
        return;
      }
      if (data.type === "shortcut" && typeof data.key === "string") {
        const mode = annotationModeForShortcut(data.key);
        if (mode) chooseAnnotationMode(mode);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    const target = iframeRef.current?.contentWindow;
    if (!target) return;
    const roots = annotations.filter((item) => !item.parentAnnotationId && (showResolved || !item.resolvedAt));
    const markers = roots.map((item, index) => ({
      id: item.id,
      shape: item.shape,
      resolved: Boolean(item.resolvedAt),
      label: item.shape.type === "pin" || item.shape.type === "note" ? index + 1 : null
    }));
    target.postMessage(
      { source: "opendrop-host", type: "state", mode: annotationMode, markers, selectedId: selectedAnnotationId, draft: draftShape },
      "*"
    );
  }, [annotations, showResolved, annotationMode, selectedAnnotationId, draftShape, bridgeNonce]);

  useEffect(() => {
    if (!selectedAnnotationId) return;
    document.querySelector(`[data-thread-id="${selectedAnnotationId}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    iframeRef.current?.contentWindow?.postMessage({ source: "opendrop-host", type: "scrollTo", id: selectedAnnotationId }, "*");
  }, [selectedAnnotationId]);

  useEffect(() => {
    if (!publish) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isEditableShortcutTarget(event.target)) return;
      const mode = annotationModeForShortcut(event.key);
      if (!mode) return;
      event.preventDefault();
      chooseAnnotationMode(mode);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [publish]);

  useEffect(() => {
    if (!commentsOpen) return;

    const keepReviewSurfaceInteractive = () => {
      const root = document.getElementById("root");
      root?.removeAttribute("aria-hidden");
      root?.removeAttribute("data-aria-hidden");
      root?.removeAttribute("inert");
      document.body.style.pointerEvents = "auto";
    };

    keepReviewSurfaceInteractive();
    const frame = window.requestAnimationFrame(keepReviewSurfaceInteractive);
    const observer = new MutationObserver(keepReviewSurfaceInteractive);
    const root = document.getElementById("root");
    if (root) observer.observe(root, { attributes: true, attributeFilter: ["aria-hidden", "data-aria-hidden", "inert"] });
    observer.observe(document.body, { attributes: true, attributeFilter: ["style"] });

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [commentsOpen]);

  useEffect(() => {
    if (files.length > 0) {
      validate();
    }
  }, [files]);

  useEffect(() => {
    if (view === "device" && session?.authenticated && deviceCode) {
      loadDeviceRequest();
    }
  }, [view, session?.authenticated, deviceCode]);

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
    setPublish(null);
    location.href = "/";
  }

  const formData = useMemo(() => {
    const data = new FormData();
    for (const file of files) {
      const path = uploadPath(file);
      data.append("files", file, path);
    }
    if (namespace.trim()) data.append("namespace", namespace);
    if (slug.trim()) data.append("slug", slug);
    data.append("visibility", visibility);
    return data;
  }, [files, namespace, slug, visibility]);

  async function validate() {
    setStatus("Validating upload...");
    const response = await fetch("/api/uploads/validate", { method: "POST", credentials: "include", body: formData });
    const result = validationResultSchema.safeParse(await response.json());
    if (!result.success) {
      setStatus("Validation response was invalid.");
      return;
    }
    setValidation(result.data);
    setStatus(response.ok ? "Ready to publish." : "Validation needs attention.");
  }

  async function publishUpload() {
    const metadata = uploadMetadataSchema.safeParse({
      namespace: namespace.trim() || undefined,
      slug: slug.trim() || undefined,
      visibility
    });
    if (!metadata.success) {
      setStatus(validationMessage(metadata.error));
      return;
    }
    setIsPublishing(true);
    setStatus("Publishing version...");
    try {
      const response = await fetch("/api/uploads/publish", { method: "POST", credentials: "include", body: uploadFormData(files, metadata.data) });
      const result = await response.json();
      if (!response.ok) {
        setStatus(result.error || "Publish failed.");
        return;
      }
      setLastPublished(result);
      setActiveVersionId(result.version.id);
      setStatus("Published.");
      await loadVersions(result.namespace, result.slug);
    } finally {
      setIsPublishing(false);
    }
  }

  function acceptUploadFiles(nextFiles: File[], source: "folder" | "zip" | "drop") {
    const errors: string[] = [];
    let acceptedFiles = nextFiles;

    if (source === "zip") {
      acceptedFiles = nextFiles.filter((file) => file.name.toLowerCase().endsWith(".zip"));
      if (acceptedFiles.length !== nextFiles.length) {
        errors.push("Choose a .zip file, or drop a folder for regular files.");
      }
    }

    if (acceptedFiles.length === 0) {
      errors.push("No uploadable files were selected.");
    }

    setUploadErrors(errors);
    if (acceptedFiles.length === 0) return;

    setFiles(acceptedFiles);
    setValidation(null);
    setLastPublished(null);
    setStatus(source === "drop" ? "Files dropped. Validating..." : "Files selected. Validating...");
  }

  function clearUploadFiles() {
    setFiles([]);
    setValidation(null);
    setLastPublished(null);
    setUploadErrors([]);
    setStatus("Upload cleared.");
    if (folderInputRef.current) folderInputRef.current.value = "";
    if (zipInputRef.current) zipInputRef.current.value = "";
  }

  async function handleUploadDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setUploadDragging(false);
    try {
      const droppedFiles = await filesFromDataTransfer(event.dataTransfer);
      acceptUploadFiles(droppedFiles, "drop");
    } catch {
      setUploadErrors(["That folder could not be read by the browser. Zip the folder and upload the .zip instead."]);
    }
  }

  async function loadVersions(ns: string, publishSlug: string) {
    const response = await fetch(`/api/deployments/${ns}/${publishSlug}/versions`, { credentials: "include" });
    const result = await response.json();
    setVersions(result.versions || []);
  }

  async function loadSharedPreview(route: PreviewRoute) {
    setStatus("Loading preview...");
    const response = await fetch(`/api/deployments/${route.namespace}/${route.slug}`, { credentials: "include" });
    const result = await response.json();
    if (!response.ok) {
      setPublish(null);
      setVersions([]);
      setStatus(result.error || "Preview not available.");
      return;
    }
    const activeVersion = route.versionId || result.family.latestVersionId || result.version.id;
    setPublish({
      namespace: route.namespace,
      slug: route.slug,
      visibility: result.family.visibility,
      url: `/${route.namespace}/${route.slug}`,
      versionUrl: `/${route.namespace}/${route.slug}?version=${activeVersion}`,
      family: result.family,
      version: result.version
    });
    setVersions(result.versions || []);
    setActiveVersionId(activeVersion);
    setStatus("Preview loaded.");
  }

  async function restoreActiveVersion() {
    if (!publish || !activeVersionId) return;
    const response = await fetch(`/api/deployments/${publish.namespace}/${publish.slug}/versions/${activeVersionId}/restore`, {
      method: "POST",
      credentials: "include"
    });
    const result = await response.json();
    if (!response.ok) {
      setStatus(result.error || "Restore failed.");
      return;
    }
    setPublish({ ...publish, family: result.family, version: result.version });
    setStatus("Restored as latest.");
    await loadVersions(publish.namespace, publish.slug);
  }

  async function updatePublishedVisibility(nextVisibility: Visibility) {
    if (!publish) return;
    const response = await fetch(`/api/deployments/${publish.namespace}/${publish.slug}/visibility`, {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visibility: nextVisibility })
    });
    const result = await response.json();
    if (!response.ok) {
      setStatus(result.error || "Visibility update failed.");
      return;
    }
    setPublish({ ...publish, visibility: result.family.visibility, family: result.family });
    setStatus(`${result.family.visibility === "private" ? "Private" : "Public"} preview saved.`);
  }

  async function addAnnotation() {
    if (!publish || !annotation.trim()) return;
    const shape = draftShape || defaultPageNoteShape();
    const created = await createAnnotation(annotation, shape, []);
    if (created) {
      setSelectedAnnotationId(created.id);
      setAnnotation("");
      setDraftShape(null);
      setStatus("Annotation added.");
    }
  }

  async function addReply(parent: AnnotationRecord) {
    if (!publish) return;
    const body = replyDrafts[parent.id]?.trim();
    if (!body) return;
    const root = rootAnnotationFor(parent) || parent;
    const created = await createAnnotation(body, root.shape, [], root.id);
    if (created) {
      setReplyDrafts((current) => ({ ...current, [parent.id]: "" }));
      setReplyingTo(null);
      setSelectedAnnotationId(root.id);
      setStatus("Reply added.");
    }
  }

  function isSubmitShortcut(event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    return event.key === "Enter" && (event.metaKey || event.ctrlKey);
  }

  function handleReplyKeyDown(event: React.KeyboardEvent<HTMLInputElement>, parent: AnnotationRecord) {
    if (event.key !== "Enter") return;
    if (!event.shiftKey || event.metaKey || event.ctrlKey) {
      event.preventDefault();
      addReply(parent);
    }
  }

  function defaultPageNoteShape(): AnnotationShape {
    return { type: "note", x: 0.5, y: 0.5 };
  }

  async function createAnnotation(body: string, shape: AnnotationShape, tags: string[], parentAnnotationId?: string): Promise<AnnotationRecord | null> {
    if (!publish) return null;
    const input = annotationInputSchema.safeParse({
      versionId: activeVersionId || publish.version.id,
      pagePath: "/",
      parentAnnotationId,
      body,
      tags,
      shape,
      viewport: { width: window.innerWidth, height: window.innerHeight, scrollX: 0, scrollY: 0 }
    });
    if (!input.success) {
      setStatus(validationMessage(input.error));
      return null;
    }
    const response = await fetch(`/api/deployments/${publish.namespace}/${publish.slug}/annotations`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input.data)
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      setStatus(result.error || "Sign in to add annotations.");
      return null;
    }
    const result = await response.json();
    await loadAnnotations(publish.namespace, publish.slug, activeVersionId || publish.version.id);
    return result.annotation || null;
  }

  async function loadAnnotations(ns: string, publishSlug: string, versionId: string) {
    const params = new URLSearchParams({ path: "/", versionId });
    const response = await fetch(`/api/deployments/${ns}/${publishSlug}/annotations?${params}`, { credentials: "include" });
    if (response.ok) {
      const result = await response.json();
      setAnnotations(result.annotations || []);
    }
  }

  async function setAnnotationResolved(annotationId: string, resolved: boolean) {
    if (!publish) return;
    const response = await fetch(`/api/deployments/${publish.namespace}/${publish.slug}/annotations/${annotationId}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resolved })
    });
    if (response.ok) {
      await loadAnnotations(publish.namespace, publish.slug, activeVersionId || publish.version.id);
      setStatus(resolved ? "Annotation resolved." : "Annotation reopened.");
    }
  }

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
    setView("settings");
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
    setNamespace(result.namespace.name);
    setStatus(`Namespace /${result.namespace.name} created.`);
    await loadNamespaces();
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

  async function loadDeviceRequest() {
    const params = deviceRequestParamsSchema.safeParse({ userCode: deviceCode });
    if (!params.success) {
      setStatus(validationMessage(params.error));
      return;
    }
    const response = await fetch(`/api/device/requests/${encodeURIComponent(params.data.userCode)}`, { credentials: "include" });
    if (response.ok) {
      const result = await response.json();
      setDeviceRequest(result.request);
      setStatus("CLI request loaded.");
    } else {
      setStatus("CLI request not found or login required.");
    }
  }

  async function decideDevice(decision: "approve" | "reject") {
    const body = deviceDecisionBodySchema.safeParse({ userCode: deviceCode, decision });
    if (!body.success) {
      setStatus(validationMessage(body.error));
      return;
    }
    const response = await fetch("/api/device/approve", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body.data)
    });
    if (!response.ok) {
      setStatus("CLI connection action failed.");
      return;
    }
    setDeviceRequest((current) => (current ? { ...current, status: decision === "approve" ? "approved" : "rejected" } : current));
    setStatus(decision === "approve" ? "CLI connection approved. You can return to the terminal." : "CLI connection rejected.");
    await loadConnections();
  }

  function chooseAnnotationMode(mode: AnnotationMode) {
    setAnnotationMode(mode);
    setDraftShape(null);
    const messages: Record<AnnotationMode, string> = {
      browse: "Browse mode: scroll and click through the preview.",
      comment: "Comment mode: click anywhere on the preview to drop a comment.",
      highlight: "Highlight mode: select text in the preview, then comment on it."
    };
    setStatus(messages[mode]);
  }

  function annotationModeForShortcut(key: string): AnnotationMode | null {
    const normalized = key.toLowerCase();
    if (normalized === "b") return "browse";
    if (normalized === "c") return "comment";
    if (normalized === "h") return "highlight";
    return null;
  }

  function isEditableShortcutTarget(target: EventTarget | null) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']"));
  }

  function selectVersion(versionId: string) {
    setActiveVersionId(versionId);
    if (!previewRoute) return;
    const url = new URL(location.href);
    if (versionId && versionId !== publish?.family.latestVersionId) {
      url.searchParams.set("version", versionId);
    } else {
      url.searchParams.delete("version");
    }
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  function shareUrl(): string {
    if (!publish) return location.href;
    const current = activeVersionId || publish.version.id;
    const isLatest = current === publish.family.latestVersionId;
    const query = isLatest ? "" : `?version=${encodeURIComponent(current)}`;
    return `${location.origin}/${publish.namespace}/${publish.slug}${query}`;
  }

  async function copyVersionUrl() {
    if (!publish) return;
    try {
      await navigator.clipboard.writeText(shareUrl());
      setStatus(activeVersionId === publish.family.latestVersionId ? "Preview link copied." : "Version link copied.");
    } catch {
      setStatus("Copy failed. Use the browser address bar instead.");
    }
  }

  async function copyLastPublishedUrl() {
    if (!lastPublishedDisplayUrl) return;
    try {
      await navigator.clipboard.writeText(lastPublishedDisplayUrl);
      setStatus("Preview URL copied.");
    } catch {
      setStatus("Copy failed. Use the link instead.");
    }
  }

  const previewSrc = publish ? `/preview/${publish.namespace}/${publish.slug}/${activeVersionId || "latest"}/index.html` : "";
  function rootAnnotationFor(item: AnnotationRecord): AnnotationRecord | null {
    let current = item;
    const seen = new Set<string>();
    while (current.parentAnnotationId) {
      if (seen.has(current.id)) return null;
      seen.add(current.id);
      const parent = annotations.find((candidate) => candidate.id === current.parentAnnotationId);
      if (!parent) return null;
      current = parent;
    }
    return current;
  }
  const repliesByParent = useMemo(() => {
    const grouped: Record<string, AnnotationRecord[]> = {};
    for (const item of annotations) {
      if (!item.parentAnnotationId) continue;
      const root = rootAnnotationFor(item);
      if (!root) continue;
      grouped[root.id] = [...(grouped[root.id] || []), item];
    }
    for (const key of Object.keys(grouped)) {
      grouped[key].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }
    return grouped;
  }, [annotations]);
  const rootAnnotations = annotations.filter((item) => !item.parentAnnotationId);
  const openAnnotationCount = rootAnnotations.filter((item) => !item.resolvedAt).length;
  const visibleRootAnnotations = rootAnnotations.filter((item) => showResolved || !item.resolvedAt);
  const publishedVisibility = publish?.family.visibility ?? publish?.visibility ?? "public";
  const isPublishedOwner = Boolean(publish && session?.user?.id === publish.family.ownerUserId);

  if (!session) return <AuthLanding loading session={session} devAuthEmail={devAuthEmail} setDevAuthEmail={setDevAuthEmail} devLogin={devLogin} startOAuth={startOAuth} />;
  if (!session.authenticated && !previewRoute) return <AuthLanding session={session} devAuthEmail={devAuthEmail} setDevAuthEmail={setDevAuthEmail} devLogin={devLogin} startOAuth={startOAuth} />;
  if (publish) {
    return (
      <PreviewRoom
        session={session}
        publish={publish}
        versions={versions}
        activeVersionId={activeVersionId}
        previewSrc={previewSrc}
        frameRef={frameRef}
        iframeRef={iframeRef}
        commentsOpen={commentsOpen}
        setCommentsOpen={setCommentsOpen}
        annotationMode={annotationMode}
        chooseAnnotationMode={chooseAnnotationMode}
        setBridgeNonce={setBridgeNonce}
        isPublishedOwner={isPublishedOwner}
        publishedVisibility={publishedVisibility}
        selectVersion={selectVersion}
        restoreActiveVersion={restoreActiveVersion}
        updatePublishedVisibility={updatePublishedVisibility}
        copyVersionUrl={copyVersionUrl}
        draftShape={draftShape}
        annotation={annotation}
        setAnnotation={setAnnotation}
        isSubmitShortcut={isSubmitShortcut}
        addAnnotation={addAnnotation}
        annotations={annotations}
        openAnnotationCount={openAnnotationCount}
        visibleRootAnnotations={visibleRootAnnotations}
        repliesByParent={repliesByParent}
        selectedAnnotationId={selectedAnnotationId}
        setSelectedAnnotationId={setSelectedAnnotationId}
        replyDrafts={replyDrafts}
        setReplyDrafts={setReplyDrafts}
        replyingTo={replyingTo}
        setReplyingTo={setReplyingTo}
        showResolved={showResolved}
        setShowResolved={setShowResolved}
        addReply={addReply}
        handleReplyKeyDown={handleReplyKeyDown}
        setAnnotationResolved={setAnnotationResolved}
      />
    );
  }
  if (previewRoute) return <PreviewLoading status={status} authenticated={Boolean(session.authenticated)} />;

  return (
    <DashboardShell
      session={session}
      activeSidebarItem={activeSidebarItem}
      hasReviewWorkspace={hasReviewWorkspace}
      pageTitle={pageTitle}
      pageSubtitle={pageSubtitle}
      status={status}
      statusLabel={statusLabel}
      setView={setView}
      setSettingsTab={setSettingsTab}
      setStatus={setStatus}
      chooseAnnotationMode={chooseAnnotationMode}
      loadSettings={loadSettings}
      logout={logout}
    >
      {view === "uploads" ? (
        <UploadWorkspace
          files={files}
          uploadDragging={uploadDragging}
          setUploadDragging={setUploadDragging}
          uploadErrors={uploadErrors}
          folderInputRef={folderInputRef}
          zipInputRef={zipInputRef}
          acceptUploadFiles={acceptUploadFiles}
          clearUploadFiles={clearUploadFiles}
          handleUploadDrop={handleUploadDrop}
          routePreview={routePreview}
          lastPublished={lastPublished}
          lastPublishedHref={lastPublishedHref}
          lastPublishedDisplayUrl={lastPublishedDisplayUrl}
          copyLastPublishedUrl={copyLastPublishedUrl}
          validation={validation}
          namespace={namespace}
          setNamespace={setNamespace}
          slug={slug}
          setSlug={setSlug}
          visibility={visibility}
          setVisibility={setVisibility}
          publishUpload={publishUpload}
          isPublishing={isPublishing}
        />
      ) : null}

      {view === "settings" ? (
        <SettingsWorkspace
          settingsTab={settingsTab}
          setSettingsTab={setSettingsTab}
          namespaces={namespaces}
          namespaceMembers={namespaceMembers}
          newNamespace={newNamespace}
          setNewNamespace={setNewNamespace}
          publisherDrafts={publisherDrafts}
          setPublisherDrafts={setPublisherDrafts}
          connections={connections}
          loadNamespaces={loadNamespaces}
          loadConnections={loadConnections}
          createCustomNamespace={createCustomNamespace}
          addPublisher={addPublisher}
          removePublisher={removePublisher}
          revokeConnection={revokeConnection}
        />
      ) : null}

      {view === "device" ? (
        <DeviceApprovalPanel
          deviceCode={deviceCode}
          deviceRequest={deviceRequest}
          loadDeviceRequest={loadDeviceRequest}
          decideDevice={decideDevice}
          showConnections={showConnections}
        />
      ) : null}
    </DashboardShell>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
