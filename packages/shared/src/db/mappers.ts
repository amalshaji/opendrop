import { annotationShapeSchema, annotationTagsSchema, annotationViewportSchema, type Visibility } from "../core";
import type { AnnotationRecord, NamespaceAccessRecord, NamespaceMemberRecord, NamespaceRecord, UserRecord } from "./types";

export function mapUser(row: any): UserRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
    defaultNamespace: row.default_namespace,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapNamespace(row: any): NamespaceRecord {
  return {
    id: row.id,
    name: row.name,
    ownerUserId: row.owner_user_id,
    createdAt: row.created_at
  };
}

export function mapNamespaceAccess(row: any): NamespaceAccessRecord {
  return {
    ...mapNamespace(row),
    role: row.role
  };
}

export function mapNamespaceMember(row: any): NamespaceMemberRecord {
  return {
    namespaceId: row.namespace_id,
    userId: row.user_id,
    email: row.email,
    name: row.name,
    role: row.role,
    createdAt: row.created_at
  };
}

export function mapAnnotation(row: any): AnnotationRecord {
  return {
    id: row.id,
    familyId: row.family_id,
    versionId: row.version_id,
    parentAnnotationId: row.parent_annotation_id,
    pagePath: row.page_path,
    authorUserId: row.author_user_id,
    body: row.body,
    tags: parseJsonColumn(annotationTagsSchema, row.tags_json),
    shape: parseJsonColumn(annotationShapeSchema, row.shape_json),
    viewport: parseJsonColumn(annotationViewportSchema.nullable(), row.viewport_json),
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function parseJsonColumn<T>(schema: { parse(value: unknown): T }, value: unknown): T {
  return schema.parse(typeof value === "string" ? JSON.parse(value) : value);
}

export function mapVisibility(value: string): Visibility {
  return value as Visibility;
}
