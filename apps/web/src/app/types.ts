import type { AnnotationShape, Visibility } from "@opendrop/shared/core";

export type Session = {
  authenticated: boolean;
  authMode: string;
  user: null | {
    id: string;
    email: string;
    defaultNamespace: string;
  };
  defaultVisibility: Visibility;
  oauthProviders: Array<"github" | "google">;
  loginUrl: string | null;
};

export type NamespaceAccess = {
  id: string;
  name: string;
  ownerUserId: string;
  role: "owner" | "publisher";
  createdAt: string;
};

export type NamespaceMember = {
  namespaceId: string;
  userId: string;
  email: string;
  name: string | null;
  role: "owner" | "publisher";
  createdAt: string;
};

export type PublishResult = {
  namespace: string;
  slug: string;
  visibility: Visibility;
  url: string;
  versionUrl: string;
  family: { ownerUserId: string; latestVersionId: string; visibility: Visibility };
  version: { id: string; versionNumber: number; createdAt: string };
};

export type DeploymentVersion = {
  id: string;
  versionNumber: number;
  createdAt: string;
};

export type CliConnection = {
  id: string;
  label: string | null;
  deviceName: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type DeviceRequest = {
  id: string;
  userCode: string;
  status: string;
  label: string | null;
  deviceName: string | null;
  expiresAt: string;
};

export type AnnotationRecord = {
  id: string;
  parentAnnotationId: string | null;
  pagePath: string;
  authorUserId: string;
  author?: { email: string | null; name: string | null } | null;
  body: string;
  tags: string[];
  shape: AnnotationShape;
  viewport: { width: number; height: number; scrollX: number; scrollY: number };
  resolvedAt: string | null;
  createdAt: string;
};

export type AnnotationMode = "browse" | "comment" | "highlight";

export type DashboardView = "uploads" | "settings" | "device";

export type SettingsTab = "namespaces" | "connections";

export type PreviewRoute = {
  namespace: string;
  slug: string;
  versionId?: string;
};

export type WebkitEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
};

export type WebkitFileEntry = WebkitEntry & {
  file: (success: (file: File) => void, error?: (error: DOMException) => void) => void;
};

export type WebkitDirectoryEntry = WebkitEntry & {
  createReader: () => {
    readEntries: (success: (entries: WebkitEntry[]) => void, error?: (error: DOMException) => void) => void;
  };
};

export type WebkitDataTransferItem = DataTransferItem & {
  webkitGetAsEntry?: () => WebkitEntry | null;
};
