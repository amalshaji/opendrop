import {
  annotationShapeSchema,
  annotationTagsSchema,
  annotationViewportSchema,
  namespaceCandidateForEmail,
  namespaceCollisionSuffix,
  validateNamespace
} from "../core";
import type { AnnotationInput, Visibility } from "../core";
import type {
  AnnotationRecord,
  DeploymentFamilyRecord,
  DeploymentFileRecord,
  DeploymentVersionRecord,
  NamespaceAccessRecord,
  NamespaceMemberRecord,
  NamespaceRecord
} from "./types";
import { parseJsonColumn } from "./mappers";

interface DeploymentFamilyRow extends Omit<DeploymentFamilyRecord, "visibility"> {
  visibility: string;
}

interface DeploymentVersionRow extends Omit<DeploymentVersionRecord, "totalBytes"> {
  totalBytes: number | string | bigint;
}

interface DeploymentFileRow extends Omit<DeploymentFileRecord, "lineCount"> {
  lineCount: number | null | undefined;
}

interface AnnotationRow {
  id: string;
  familyId: string;
  versionId: string;
  parentAnnotationId: string | null;
  pagePath: string;
  authorUserId: string;
  body: string;
  tagsJson: string;
  shapeJson: string;
  viewportJson: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function mapDeploymentFamily(row: DeploymentFamilyRow): DeploymentFamilyRecord {
  return {
    ...row,
    visibility: row.visibility as Visibility
  };
}

export function mapDeploymentVersion(row: DeploymentVersionRow): DeploymentVersionRecord {
  return {
    ...row,
    totalBytes: Number(row.totalBytes)
  };
}

export function mapDeploymentFile(row: DeploymentFileRow): DeploymentFileRecord {
  return {
    ...row,
    lineCount: row.lineCount ?? undefined
  };
}

export function mapDbAnnotation(row: AnnotationRow): AnnotationRecord {
  return {
    id: row.id,
    familyId: row.familyId,
    versionId: row.versionId,
    parentAnnotationId: row.parentAnnotationId,
    pagePath: row.pagePath,
    authorUserId: row.authorUserId,
    body: row.body,
    tags: parseJsonColumn(annotationTagsSchema, row.tagsJson),
    shape: parseJsonColumn(annotationShapeSchema, row.shapeJson),
    viewport: parseJsonColumn(annotationViewportSchema.nullable(), row.viewportJson),
    resolvedAt: row.resolvedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function namespaceRole(role: string): "owner" | "publisher" {
  return role === "owner" ? "owner" : "publisher";
}

export function namespaceAccessRecords(
  owned: NamespaceRecord[],
  published: Array<NamespaceRecord & { role: string }>
): NamespaceAccessRecord[] {
  return [
    ...owned.map((namespace) => ({ ...namespace, role: "owner" as const })),
    ...published.map((namespace) => ({ ...namespace, role: namespaceRole(namespace.role) }))
  ].sort((a, b) => a.name.localeCompare(b.name));
}

export function namespaceMemberRecord(member: Omit<NamespaceMemberRecord, "role"> & { role: string }): NamespaceMemberRecord {
  return {
    ...member,
    role: namespaceRole(member.role)
  };
}

export async function allocateNamespaceForEmail(
  email: string,
  namespaceExists: (candidate: string) => Promise<boolean>
): Promise<string> {
  const seed = namespaceCandidateForEmail(email);
  const validSeed = validateNamespace(seed) ? `user-${namespaceCollisionSuffix()}` : seed;
  let candidate = validSeed;
  while (await namespaceExists(candidate)) {
    candidate = `${validSeed.slice(0, 34)}-${namespaceCollisionSuffix()}`;
  }
  return candidate;
}

export function annotationInsertValues(
  deployment: { family: { id: string }; version: { id: string } },
  input: AnnotationInput,
  userId: string,
  id: string,
  now: string
) {
  return {
    id,
    familyId: deployment.family.id,
    versionId: deployment.version.id,
    parentAnnotationId: input.parentAnnotationId ?? null,
    pagePath: input.pagePath,
    authorUserId: userId,
    body: input.body,
    tagsJson: JSON.stringify(input.tags),
    shapeJson: JSON.stringify(input.shape),
    viewportJson: JSON.stringify(input.viewport),
    resolvedAt: null,
    createdAt: now,
    updatedAt: now
  };
}
