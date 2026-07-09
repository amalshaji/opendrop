import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  uploadMetadataSchema,
  validationResultSchema,
  type ValidationResult,
  type Visibility
} from "@opendrop/shared/core";
import { validationMessage } from "@/app/format";
import { filesFromDataTransfer, uploadFormData, uploadPath } from "@/app/upload-files";
import type { PublishResult, Session } from "@/app/types";

interface UseUploadWorkflowOptions {
  session: Session | null;
  setStatus: (status: string) => void;
  onPublished: (result: PublishResult) => Promise<void> | void;
}

export function useUploadWorkflow({ session, setStatus, onPublished }: UseUploadWorkflowOptions) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploadDragging, setUploadDragging] = useState(false);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [namespace, setNamespace] = useState("");
  const [slug, setSlug] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [lastPublished, setLastPublished] = useState<PublishResult | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const zipInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (session?.user) {
      setNamespace(session.user.defaultNamespace);
      setVisibility(session.defaultVisibility);
    }
  }, [session]);

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

  useEffect(() => {
    if (files.length > 0) {
      void validate();
    }
  }, [files]);

  const routePreview = `/${namespace.trim() || session?.user?.defaultNamespace || "namespace"}/${slug.trim() || "random-slug"}`;
  const lastPublishedHref = lastPublished?.url || lastPublished?.versionUrl || "";
  const lastPublishedDisplayUrl = lastPublishedHref ? `${location.origin}${lastPublishedHref}` : "";

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
      setStatus("Published.");
      await onPublished(result);
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

  async function handleUploadDrop(event: DragEvent<HTMLDivElement>) {
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

  async function copyLastPublishedUrl() {
    if (!lastPublishedDisplayUrl) return;
    try {
      await navigator.clipboard.writeText(lastPublishedDisplayUrl);
      setStatus("Preview URL copied.");
    } catch {
      setStatus("Copy failed. Use the link instead.");
    }
  }

  return {
    files,
    uploadDragging,
    setUploadDragging,
    uploadErrors,
    folderInputRef,
    zipInputRef,
    acceptUploadFiles,
    clearUploadFiles,
    handleUploadDrop,
    routePreview,
    lastPublished,
    lastPublishedHref,
    lastPublishedDisplayUrl,
    copyLastPublishedUrl,
    validation,
    namespace,
    setNamespace,
    slug,
    setSlug,
    visibility,
    setVisibility,
    publishUpload,
    isPublishing
  };
}
