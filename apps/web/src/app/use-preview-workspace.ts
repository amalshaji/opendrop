import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { annotationInputSchema, type AnnotationShape, type Visibility } from "@opendrop/shared/core";
import { validationMessage } from "@/app/format";
import type {
  AnnotationMode,
  AnnotationRecord,
  DeploymentVersion,
  PreviewRoute,
  PublishResult,
  Session
} from "@/app/types";

interface UsePreviewWorkspaceOptions {
  previewRoute: PreviewRoute | null;
  session: Session | null;
  setStatus: (status: string) => void;
}

export function usePreviewWorkspace({ previewRoute, session, setStatus }: UsePreviewWorkspaceOptions) {
  const [publish, setPublish] = useState<PublishResult | null>(null);
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
  const frameRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (previewRoute) {
      void loadSharedPreview(previewRoute);
    }
  }, [previewRoute?.namespace, previewRoute?.slug, previewRoute?.versionId, session?.authenticated]);

  useEffect(() => {
    if (publish && activeVersionId) {
      void loadAnnotations(publish.namespace, publish.slug, activeVersionId);
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

  const previewSrc = publish ? `/preview/${publish.namespace}/${publish.slug}/${activeVersionId || "latest"}/index.html` : "";
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

  async function handlePublished(result: PublishResult) {
    setActiveVersionId(result.version.id);
    await loadVersions(result.namespace, result.slug);
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

  function isSubmitShortcut(event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    return event.key === "Enter" && (event.metaKey || event.ctrlKey);
  }

  function handleReplyKeyDown(event: ReactKeyboardEvent<HTMLInputElement>, parent: AnnotationRecord) {
    if (event.key !== "Enter") return;
    if (!event.shiftKey || event.metaKey || event.ctrlKey) {
      event.preventDefault();
      void addReply(parent);
    }
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

  return {
    publish,
    setPublish,
    versions,
    activeVersionId,
    previewSrc,
    frameRef,
    iframeRef,
    commentsOpen,
    setCommentsOpen,
    annotationMode,
    chooseAnnotationMode,
    setBridgeNonce,
    isPublishedOwner,
    publishedVisibility,
    selectVersion,
    restoreActiveVersion,
    updatePublishedVisibility,
    copyVersionUrl,
    draftShape,
    annotation,
    setAnnotation,
    isSubmitShortcut,
    addAnnotation,
    annotations,
    openAnnotationCount,
    visibleRootAnnotations,
    repliesByParent,
    selectedAnnotationId,
    setSelectedAnnotationId,
    replyDrafts,
    setReplyDrafts,
    replyingTo,
    setReplyingTo,
    showResolved,
    setShowResolved,
    addReply,
    handleReplyKeyDown,
    setAnnotationResolved,
    handlePublished,
    loadVersions
  };
}

function defaultPageNoteShape(): AnnotationShape {
  return { type: "note", x: 0.5, y: 0.5 };
}
