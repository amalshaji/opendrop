import type { AnnotationInput, FileManifestEntry, Visibility } from "../core";
import type {
  AnnotationRecord,
  DeploymentFamilyRecord,
  DeploymentFileRecord,
  DeploymentVersionRecord,
  DeploymentWithVersion,
  IdentityInput,
  NamespaceAccessRecord,
  NamespaceMemberRecord,
  NamespaceRecord,
  UserRecord
} from "./types";

export interface CreateVersionInput {
  namespace: string;
  slug: string;
  versionId?: string;
  ownerUserId: string;
  visibility: Visibility;
  manifestHash: string;
  files: Array<FileManifestEntry & { storageKey: string }>;
}

export type DeviceTokenExchangeResult =
  | { status: "issued"; expiresAt: string }
  | { status: "pending" | "rejected" | "expired" | "already_exchanged"; expiresAt: string };

export interface OpenDropRepository {
  migrate(): Promise<void>;
  getOrCreateUser(identity: IdentityInput): Promise<UserRecord>;
  linkIdentityToEmail(identity: IdentityInput): Promise<UserRecord | null>;
  getUserByIdentity(provider: IdentityInput["provider"], subject: string): Promise<UserRecord | null>;
  getUserById(id: string): Promise<UserRecord | null>;
  getUserByCliTokenHash(tokenHash: string): Promise<UserRecord | null>;
  createCliToken(userId: string, tokenHash: string, label?: string, deviceName?: string, userAgent?: string): Promise<string>;
  listCliTokens(userId: string): Promise<Array<{ id: string; label: string | null; deviceName: string | null; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }>>;
  revokeCliToken(userId: string, tokenId: string): Promise<void>;
  createDeviceAuthorization(input: {
    deviceCodeHash: string;
    userCode: string;
    label?: string;
    deviceName?: string;
    userAgent?: string;
    expiresAt: string;
  }): Promise<{ id: string; userCode: string; expiresAt: string }>;
  getDeviceAuthorizationByUserCode(userCode: string): Promise<{
    id: string;
    userCode: string;
    status: string;
    label: string | null;
    deviceName: string | null;
    expiresAt: string;
  } | null>;
  approveDeviceAuthorization(userCode: string, userId: string): Promise<void>;
  rejectDeviceAuthorization(userCode: string, userId: string): Promise<void>;
  exchangeDeviceAuthorization(deviceCodeHash: string, tokenHash: string): Promise<DeviceTokenExchangeResult | null>;
  getNamespace(name: string): Promise<NamespaceRecord | null>;
  listNamespacesForUser(userId: string): Promise<NamespaceAccessRecord[]>;
  createNamespace(name: string, ownerUserId: string): Promise<NamespaceAccessRecord>;
  listNamespaceMembers(namespace: string, ownerUserId: string): Promise<NamespaceMemberRecord[]>;
  addNamespacePublisher(namespace: string, ownerUserId: string, email: string): Promise<NamespaceMemberRecord>;
  removeNamespacePublisher(namespace: string, ownerUserId: string, memberUserId: string): Promise<void>;
  userCanPublishNamespace(userId: string, namespace: string): Promise<boolean>;
  getDeploymentFamily(namespace: string, slug: string): Promise<DeploymentFamilyRecord | null>;
  listDeploymentsForUser(userId: string): Promise<DeploymentWithVersion[]>;
  createDeploymentVersion(input: CreateVersionInput): Promise<DeploymentWithVersion>;
  setDeploymentVisibility(namespace: string, slug: string, visibility: Visibility, userId: string): Promise<DeploymentFamilyRecord>;
  restoreDeploymentVersion(namespace: string, slug: string, versionId: string, userId: string): Promise<DeploymentWithVersion>;
  getDeploymentVersion(namespace: string, slug: string, versionId?: string): Promise<DeploymentWithVersion | null>;
  listDeploymentVersions(namespace: string, slug: string): Promise<DeploymentVersionRecord[]>;
  listDeploymentFiles(versionId: string): Promise<DeploymentFileRecord[]>;
  getDeploymentFile(versionId: string, path: string): Promise<DeploymentFileRecord | null>;
  getAnnotation(namespace: string, slug: string, annotationId: string): Promise<AnnotationRecord | null>;
  createAnnotation(namespace: string, slug: string, input: AnnotationInput, userId: string): Promise<AnnotationRecord>;
  setAnnotationResolved(namespace: string, slug: string, annotationId: string, resolved: boolean, userId: string): Promise<AnnotationRecord>;
  listAnnotations(namespace: string, slug: string, versionId: string, pagePath?: string): Promise<AnnotationRecord[]>;
}
