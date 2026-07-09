import { boolean as pgBoolean, index as pgIndex, integer as pgInteger, pgTable, primaryKey as pgPrimaryKey, text as pgText, timestamp as pgTimestamp, uniqueIndex as pgUniqueIndex } from "drizzle-orm/pg-core";
import { index as sqliteIndex, integer as sqliteInteger, primaryKey as sqlitePrimaryKey, sqliteTable, text as sqliteText, uniqueIndex as sqliteUniqueIndex } from "drizzle-orm/sqlite-core";

export const sqliteBetterAuthUsers = sqliteTable("user", {
  id: sqliteText("id").primaryKey(),
  name: sqliteText("name").notNull(),
  email: sqliteText("email").notNull().unique(),
  emailVerified: sqliteInteger("emailVerified").notNull().default(0),
  image: sqliteText("image"),
  createdAt: sqliteInteger("createdAt").notNull(),
  updatedAt: sqliteInteger("updatedAt").notNull()
});

export const sqliteBetterAuthSessions = sqliteTable("session", {
  id: sqliteText("id").primaryKey(),
  expiresAt: sqliteInteger("expiresAt").notNull(),
  token: sqliteText("token").notNull().unique(),
  createdAt: sqliteInteger("createdAt").notNull(),
  updatedAt: sqliteInteger("updatedAt").notNull(),
  ipAddress: sqliteText("ipAddress"),
  userAgent: sqliteText("userAgent"),
  userId: sqliteText("userId").notNull().references(() => sqliteBetterAuthUsers.id)
});

export const sqliteBetterAuthAccounts = sqliteTable("account", {
  id: sqliteText("id").primaryKey(),
  accountId: sqliteText("accountId").notNull(),
  providerId: sqliteText("providerId").notNull(),
  userId: sqliteText("userId").notNull().references(() => sqliteBetterAuthUsers.id),
  accessToken: sqliteText("accessToken"),
  refreshToken: sqliteText("refreshToken"),
  idToken: sqliteText("idToken"),
  accessTokenExpiresAt: sqliteInteger("accessTokenExpiresAt"),
  refreshTokenExpiresAt: sqliteInteger("refreshTokenExpiresAt"),
  scope: sqliteText("scope"),
  password: sqliteText("password"),
  createdAt: sqliteInteger("createdAt").notNull(),
  updatedAt: sqliteInteger("updatedAt").notNull()
});

export const sqliteBetterAuthVerifications = sqliteTable("verification", {
  id: sqliteText("id").primaryKey(),
  identifier: sqliteText("identifier").notNull(),
  value: sqliteText("value").notNull(),
  expiresAt: sqliteInteger("expiresAt").notNull(),
  createdAt: sqliteInteger("createdAt"),
  updatedAt: sqliteInteger("updatedAt")
});

export const sqliteUsers = sqliteTable("users", {
  id: sqliteText("id").primaryKey(),
  email: sqliteText("email").notNull().unique(),
  name: sqliteText("name"),
  avatarUrl: sqliteText("avatar_url"),
  defaultNamespace: sqliteText("default_namespace").notNull().unique(),
  createdAt: sqliteText("created_at").notNull(),
  updatedAt: sqliteText("updated_at").notNull()
});

export const sqliteIdentities = sqliteTable(
  "identities",
  {
    id: sqliteText("id").primaryKey(),
    userId: sqliteText("user_id").notNull().references(() => sqliteUsers.id),
    provider: sqliteText("provider").notNull(),
    providerSubject: sqliteText("provider_subject").notNull(),
    email: sqliteText("email").notNull(),
    createdAt: sqliteText("created_at").notNull(),
    updatedAt: sqliteText("updated_at").notNull()
  },
  (table) => [sqliteUniqueIndex("idx_identities_provider_subject").on(table.provider, table.providerSubject)]
);

export const sqliteNamespaces = sqliteTable("namespaces", {
  id: sqliteText("id").primaryKey(),
  name: sqliteText("name").notNull().unique(),
  ownerUserId: sqliteText("owner_user_id").notNull().references(() => sqliteUsers.id),
  createdAt: sqliteText("created_at").notNull()
});

export const sqliteNamespaceMembers = sqliteTable(
  "namespace_members",
  {
    namespaceId: sqliteText("namespace_id").notNull().references(() => sqliteNamespaces.id),
    userId: sqliteText("user_id").notNull().references(() => sqliteUsers.id),
    role: sqliteText("role").notNull(),
    createdAt: sqliteText("created_at").notNull()
  },
  (table) => [sqlitePrimaryKey({ columns: [table.namespaceId, table.userId] })]
);

export const sqliteDeploymentFamilies = sqliteTable(
  "deployment_families",
  {
    id: sqliteText("id").primaryKey(),
    namespaceId: sqliteText("namespace_id").notNull().references(() => sqliteNamespaces.id),
    namespaceName: sqliteText("namespace_name").notNull(),
    slug: sqliteText("slug").notNull(),
    ownerUserId: sqliteText("owner_user_id").notNull().references(() => sqliteUsers.id),
    latestVersionId: sqliteText("latest_version_id"),
    visibility: sqliteText("visibility").notNull(),
    createdAt: sqliteText("created_at").notNull(),
    updatedAt: sqliteText("updated_at").notNull()
  },
  (table) => [
    sqliteUniqueIndex("idx_deployment_families_namespace_slug").on(table.namespaceName, table.slug),
    sqliteIndex("idx_deployment_families_owner_updated").on(table.ownerUserId, table.updatedAt)
  ]
);

export const sqliteDeploymentVersions = sqliteTable(
  "deployment_versions",
  {
    id: sqliteText("id").primaryKey(),
    familyId: sqliteText("family_id").notNull().references(() => sqliteDeploymentFamilies.id),
    versionNumber: sqliteInteger("version_number").notNull(),
    createdByUserId: sqliteText("created_by_user_id").notNull().references(() => sqliteUsers.id),
    manifestHash: sqliteText("manifest_hash").notNull(),
    fileCount: sqliteInteger("file_count").notNull(),
    totalBytes: sqliteInteger("total_bytes").notNull(),
    createdAt: sqliteText("created_at").notNull()
  },
  (table) => [
    sqliteIndex("idx_deployment_versions_family").on(table.familyId),
    sqliteUniqueIndex("idx_deployment_versions_family_number").on(table.familyId, table.versionNumber)
  ]
);

export const sqliteDeploymentFiles = sqliteTable(
  "deployment_files",
  {
    id: sqliteText("id").primaryKey(),
    versionId: sqliteText("version_id").notNull().references(() => sqliteDeploymentVersions.id),
    path: sqliteText("path").notNull(),
    size: sqliteInteger("size").notNull(),
    sha256: sqliteText("sha256").notNull(),
    contentType: sqliteText("content_type").notNull(),
    lineCount: sqliteInteger("line_count"),
    storageKey: sqliteText("storage_key").notNull()
  },
  (table) => [
    sqliteIndex("idx_deployment_files_version").on(table.versionId),
    sqliteUniqueIndex("idx_deployment_files_version_path").on(table.versionId, table.path)
  ]
);

export const sqliteAnnotations = sqliteTable(
  "annotations",
  {
    id: sqliteText("id").primaryKey(),
    familyId: sqliteText("family_id").notNull().references(() => sqliteDeploymentFamilies.id),
    versionId: sqliteText("version_id").notNull().references(() => sqliteDeploymentVersions.id),
    parentAnnotationId: sqliteText("parent_annotation_id"),
    pagePath: sqliteText("page_path").notNull(),
    authorUserId: sqliteText("author_user_id").notNull().references(() => sqliteUsers.id),
    body: sqliteText("body").notNull(),
    tagsJson: sqliteText("tags_json").notNull(),
    shapeJson: sqliteText("shape_json").notNull(),
    viewportJson: sqliteText("viewport_json").notNull(),
    resolvedAt: sqliteText("resolved_at"),
    createdAt: sqliteText("created_at").notNull(),
    updatedAt: sqliteText("updated_at").notNull()
  },
  (table) => [
    sqliteIndex("idx_annotations_family_version").on(table.familyId, table.versionId),
    sqliteIndex("idx_annotations_parent").on(table.parentAnnotationId)
  ]
);

export const sqliteCliTokens = sqliteTable("cli_tokens", {
  id: sqliteText("id").primaryKey(),
  userId: sqliteText("user_id").notNull().references(() => sqliteUsers.id),
  tokenHash: sqliteText("token_hash").notNull().unique(),
  label: sqliteText("label"),
  deviceName: sqliteText("device_name"),
  userAgent: sqliteText("user_agent"),
  createdAt: sqliteText("created_at").notNull(),
  lastUsedAt: sqliteText("last_used_at"),
  revokedAt: sqliteText("revoked_at")
});

export const sqliteDeviceAuthorizations = sqliteTable("device_authorizations", {
  id: sqliteText("id").primaryKey(),
  deviceCodeHash: sqliteText("device_code_hash").notNull().unique(),
  userCode: sqliteText("user_code").notNull().unique(),
  status: sqliteText("status").notNull(),
  userId: sqliteText("user_id").references(() => sqliteUsers.id),
  tokenHash: sqliteText("token_hash"),
  label: sqliteText("label"),
  deviceName: sqliteText("device_name"),
  userAgent: sqliteText("user_agent"),
  createdAt: sqliteText("created_at").notNull(),
  expiresAt: sqliteText("expires_at").notNull(),
  approvedAt: sqliteText("approved_at"),
  rejectedAt: sqliteText("rejected_at")
});

export const sqliteOpenDropSchema = {
  betterAuthUsers: sqliteBetterAuthUsers,
  betterAuthSessions: sqliteBetterAuthSessions,
  betterAuthAccounts: sqliteBetterAuthAccounts,
  betterAuthVerifications: sqliteBetterAuthVerifications,
  users: sqliteUsers,
  identities: sqliteIdentities,
  namespaces: sqliteNamespaces,
  namespaceMembers: sqliteNamespaceMembers,
  deploymentFamilies: sqliteDeploymentFamilies,
  deploymentVersions: sqliteDeploymentVersions,
  deploymentFiles: sqliteDeploymentFiles,
  annotations: sqliteAnnotations,
  cliTokens: sqliteCliTokens,
  deviceAuthorizations: sqliteDeviceAuthorizations
};

export const pgBetterAuthUsers = pgTable("user", {
  id: pgText("id").primaryKey(),
  name: pgText("name").notNull(),
  email: pgText("email").notNull().unique(),
  emailVerified: pgBoolean("emailVerified").notNull().default(false),
  image: pgText("image"),
  createdAt: pgTimestamp("createdAt", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: pgTimestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull()
});

export const pgBetterAuthSessions = pgTable("session", {
  id: pgText("id").primaryKey(),
  expiresAt: pgTimestamp("expiresAt", { withTimezone: true, mode: "date" }).notNull(),
  token: pgText("token").notNull().unique(),
  createdAt: pgTimestamp("createdAt", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: pgTimestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull(),
  ipAddress: pgText("ipAddress"),
  userAgent: pgText("userAgent"),
  userId: pgText("userId").notNull().references(() => pgBetterAuthUsers.id)
});

export const pgBetterAuthAccounts = pgTable("account", {
  id: pgText("id").primaryKey(),
  accountId: pgText("accountId").notNull(),
  providerId: pgText("providerId").notNull(),
  userId: pgText("userId").notNull().references(() => pgBetterAuthUsers.id),
  accessToken: pgText("accessToken"),
  refreshToken: pgText("refreshToken"),
  idToken: pgText("idToken"),
  accessTokenExpiresAt: pgTimestamp("accessTokenExpiresAt", { withTimezone: true, mode: "date" }),
  refreshTokenExpiresAt: pgTimestamp("refreshTokenExpiresAt", { withTimezone: true, mode: "date" }),
  scope: pgText("scope"),
  password: pgText("password"),
  createdAt: pgTimestamp("createdAt", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: pgTimestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull()
});

export const pgBetterAuthVerifications = pgTable("verification", {
  id: pgText("id").primaryKey(),
  identifier: pgText("identifier").notNull(),
  value: pgText("value").notNull(),
  expiresAt: pgTimestamp("expiresAt", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: pgTimestamp("createdAt", { withTimezone: true, mode: "date" }),
  updatedAt: pgTimestamp("updatedAt", { withTimezone: true, mode: "date" })
});

export const pgUsers = pgTable("users", {
  id: pgText("id").primaryKey(),
  email: pgText("email").notNull().unique(),
  name: pgText("name"),
  avatarUrl: pgText("avatar_url"),
  defaultNamespace: pgText("default_namespace").notNull().unique(),
  createdAt: pgText("created_at").notNull(),
  updatedAt: pgText("updated_at").notNull()
});

export const pgIdentities = pgTable(
  "identities",
  {
    id: pgText("id").primaryKey(),
    userId: pgText("user_id").notNull().references(() => pgUsers.id),
    provider: pgText("provider").notNull(),
    providerSubject: pgText("provider_subject").notNull(),
    email: pgText("email").notNull(),
    createdAt: pgText("created_at").notNull(),
    updatedAt: pgText("updated_at").notNull()
  },
  (table) => [pgUniqueIndex("idx_identities_provider_subject").on(table.provider, table.providerSubject)]
);

export const pgNamespaces = pgTable("namespaces", {
  id: pgText("id").primaryKey(),
  name: pgText("name").notNull().unique(),
  ownerUserId: pgText("owner_user_id").notNull().references(() => pgUsers.id),
  createdAt: pgText("created_at").notNull()
});

export const pgNamespaceMembers = pgTable(
  "namespace_members",
  {
    namespaceId: pgText("namespace_id").notNull().references(() => pgNamespaces.id),
    userId: pgText("user_id").notNull().references(() => pgUsers.id),
    role: pgText("role").notNull(),
    createdAt: pgText("created_at").notNull()
  },
  (table) => [pgPrimaryKey({ columns: [table.namespaceId, table.userId] })]
);

export const pgDeploymentFamilies = pgTable(
  "deployment_families",
  {
    id: pgText("id").primaryKey(),
    namespaceId: pgText("namespace_id").notNull().references(() => pgNamespaces.id),
    namespaceName: pgText("namespace_name").notNull(),
    slug: pgText("slug").notNull(),
    ownerUserId: pgText("owner_user_id").notNull().references(() => pgUsers.id),
    latestVersionId: pgText("latest_version_id"),
    visibility: pgText("visibility").notNull(),
    createdAt: pgText("created_at").notNull(),
    updatedAt: pgText("updated_at").notNull()
  },
  (table) => [
    pgUniqueIndex("idx_deployment_families_namespace_slug").on(table.namespaceName, table.slug),
    pgIndex("idx_deployment_families_owner_updated").on(table.ownerUserId, table.updatedAt)
  ]
);

export const pgDeploymentVersions = pgTable(
  "deployment_versions",
  {
    id: pgText("id").primaryKey(),
    familyId: pgText("family_id").notNull().references(() => pgDeploymentFamilies.id),
    versionNumber: pgInteger("version_number").notNull(),
    createdByUserId: pgText("created_by_user_id").notNull().references(() => pgUsers.id),
    manifestHash: pgText("manifest_hash").notNull(),
    fileCount: pgInteger("file_count").notNull(),
    totalBytes: pgInteger("total_bytes").notNull(),
    createdAt: pgText("created_at").notNull()
  },
  (table) => [
    pgIndex("idx_deployment_versions_family").on(table.familyId),
    pgUniqueIndex("idx_deployment_versions_family_number").on(table.familyId, table.versionNumber)
  ]
);

export const pgDeploymentFiles = pgTable(
  "deployment_files",
  {
    id: pgText("id").primaryKey(),
    versionId: pgText("version_id").notNull().references(() => pgDeploymentVersions.id),
    path: pgText("path").notNull(),
    size: pgInteger("size").notNull(),
    sha256: pgText("sha256").notNull(),
    contentType: pgText("content_type").notNull(),
    lineCount: pgInteger("line_count"),
    storageKey: pgText("storage_key").notNull()
  },
  (table) => [
    pgIndex("idx_deployment_files_version").on(table.versionId),
    pgUniqueIndex("idx_deployment_files_version_path").on(table.versionId, table.path)
  ]
);

export const pgAnnotations = pgTable(
  "annotations",
  {
    id: pgText("id").primaryKey(),
    familyId: pgText("family_id").notNull().references(() => pgDeploymentFamilies.id),
    versionId: pgText("version_id").notNull().references(() => pgDeploymentVersions.id),
    parentAnnotationId: pgText("parent_annotation_id"),
    pagePath: pgText("page_path").notNull(),
    authorUserId: pgText("author_user_id").notNull().references(() => pgUsers.id),
    body: pgText("body").notNull(),
    tagsJson: pgText("tags_json").notNull(),
    shapeJson: pgText("shape_json").notNull(),
    viewportJson: pgText("viewport_json").notNull(),
    resolvedAt: pgText("resolved_at"),
    createdAt: pgText("created_at").notNull(),
    updatedAt: pgText("updated_at").notNull()
  },
  (table) => [
    pgIndex("idx_annotations_family_version").on(table.familyId, table.versionId),
    pgIndex("idx_annotations_parent").on(table.parentAnnotationId)
  ]
);

export const pgCliTokens = pgTable("cli_tokens", {
  id: pgText("id").primaryKey(),
  userId: pgText("user_id").notNull().references(() => pgUsers.id),
  tokenHash: pgText("token_hash").notNull().unique(),
  label: pgText("label"),
  deviceName: pgText("device_name"),
  userAgent: pgText("user_agent"),
  createdAt: pgText("created_at").notNull(),
  lastUsedAt: pgText("last_used_at"),
  revokedAt: pgText("revoked_at")
});

export const pgDeviceAuthorizations = pgTable("device_authorizations", {
  id: pgText("id").primaryKey(),
  deviceCodeHash: pgText("device_code_hash").notNull().unique(),
  userCode: pgText("user_code").notNull().unique(),
  status: pgText("status").notNull(),
  userId: pgText("user_id").references(() => pgUsers.id),
  tokenHash: pgText("token_hash"),
  label: pgText("label"),
  deviceName: pgText("device_name"),
  userAgent: pgText("user_agent"),
  createdAt: pgText("created_at").notNull(),
  expiresAt: pgText("expires_at").notNull(),
  approvedAt: pgText("approved_at"),
  rejectedAt: pgText("rejected_at")
});

export const pgOpenDropSchema = {
  betterAuthUsers: pgBetterAuthUsers,
  betterAuthSessions: pgBetterAuthSessions,
  betterAuthAccounts: pgBetterAuthAccounts,
  betterAuthVerifications: pgBetterAuthVerifications,
  users: pgUsers,
  identities: pgIdentities,
  namespaces: pgNamespaces,
  namespaceMembers: pgNamespaceMembers,
  deploymentFamilies: pgDeploymentFamilies,
  deploymentVersions: pgDeploymentVersions,
  deploymentFiles: pgDeploymentFiles,
  annotations: pgAnnotations,
  cliTokens: pgCliTokens,
  deviceAuthorizations: pgDeviceAuthorizations
};
