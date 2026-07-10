import type { AnnotationInput, FileManifestEntry, Visibility } from "../core";

export interface UserRecord {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  defaultNamespace: string;
  createdAt: string;
  updatedAt: string;
}

export interface IdentityInput {
  provider: "oauth" | "trusted-header" | "dev";
  subject: string;
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
}

export interface NamespaceRecord {
  id: string;
  name: string;
  ownerUserId: string;
  createdAt: string;
}

export interface NamespaceAccessRecord extends NamespaceRecord {
  role: "owner" | "publisher";
}

export interface NamespaceMemberRecord {
  namespaceId: string;
  userId: string;
  email: string;
  name: string | null;
  role: "owner" | "publisher";
  createdAt: string;
}

export interface DeploymentFamilyRecord {
  id: string;
  namespaceId: string;
  namespaceName: string;
  slug: string;
  ownerUserId: string;
  latestVersionId: string | null;
  visibility: Visibility;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentVersionRecord {
  id: string;
  familyId: string;
  versionNumber: number;
  createdByUserId: string;
  manifestHash: string;
  fileCount: number;
  totalBytes: number;
  createdAt: string;
}

export interface DeploymentFileRecord extends FileManifestEntry {
  id: string;
  versionId: string;
  storageKey: string;
}

export interface DeploymentWithVersion {
  family: DeploymentFamilyRecord;
  version: DeploymentVersionRecord;
}

export type UploadSessionStatus = "pending" | "completed" | "failed";

export interface UploadSessionRecord {
  id: string;
  ownerUserId: string;
  namespace: string;
  slug: string;
  visibility: Visibility;
  versionId: string;
  manifestHash: string;
  manifest: FileManifestEntry[];
  status: UploadSessionStatus;
  completedResult: DeploymentWithVersion | null;
  failureReason: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AnnotationRecord {
  id: string;
  familyId: string;
  versionId: string;
  parentAnnotationId: string | null;
  pagePath: string;
  authorUserId: string;
  body: string;
  tags: string[];
  shape: AnnotationInput["shape"];
  viewport: AnnotationInput["viewport"];
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
