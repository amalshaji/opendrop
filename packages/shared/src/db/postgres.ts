import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, asc, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  nowIso,
  randomId,
  validateNamespace
} from "../core";
import type { AnnotationInput, Visibility } from "../core";
import type { CreateVersionInput, OpenDropRepository } from "./repository";
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
import {
  allocateNamespaceForEmail,
  annotationInsertValues,
  mapDbAnnotation,
  mapDeploymentFamily,
  mapDeploymentFile,
  mapDeploymentVersion,
  namespaceAccessRecords,
  namespaceMemberRecord
} from "./domain";
import { pgOpenDropSchema } from "./schema";

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../migrations");

export class PostgresOpenDropRepository implements OpenDropRepository {
  private pool: Pool;
  private orm: ReturnType<typeof drizzle<typeof pgOpenDropSchema>>;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
    this.orm = drizzle(this.pool, { schema: pgOpenDropSchema });
  }

  async migrate(): Promise<void> {
    const sql = readFileSync(resolve(migrationsDir, "0001_initial.sql"), "utf8");
    await this.pool.query(sql);
    await this.pool.query("alter table annotations add column if not exists parent_annotation_id text references annotations(id)");
    await this.pool.query("create index if not exists idx_annotations_parent on annotations(parent_annotation_id)");
  }

  async getOrCreateUser(identity: IdentityInput): Promise<UserRecord> {
    return this.orm.transaction(async (tx) => {
      const [existingIdentity] = await tx
        .select({ user: pgOpenDropSchema.users })
        .from(pgOpenDropSchema.identities)
        .innerJoin(pgOpenDropSchema.users, eq(pgOpenDropSchema.identities.userId, pgOpenDropSchema.users.id))
        .where(and(eq(pgOpenDropSchema.identities.provider, identity.provider), eq(pgOpenDropSchema.identities.providerSubject, identity.subject)))
        .limit(1);
      if (existingIdentity) {
        const now = nowIso();
        await tx
          .update(pgOpenDropSchema.users)
          .set({
            email: identity.email,
            name: identity.name ?? existingIdentity.user.name,
            avatarUrl: identity.avatarUrl ?? existingIdentity.user.avatarUrl,
            updatedAt: now
          })
          .where(eq(pgOpenDropSchema.users.id, existingIdentity.user.id));
        const [user] = await tx.select().from(pgOpenDropSchema.users).where(eq(pgOpenDropSchema.users.id, existingIdentity.user.id)).limit(1);
        if (!user) throw new Error("User not found.");
        return user;
      }

      const [byEmail] = await tx.select().from(pgOpenDropSchema.users).where(eq(pgOpenDropSchema.users.email, identity.email)).limit(1);
      if (byEmail && identity.provider === "trusted-header") {
        throw new Error("A user with this email already exists but has a different trusted-header subject.");
      }
      if (byEmail) {
        const now = nowIso();
        await tx.insert(pgOpenDropSchema.identities).values({
          id: randomId("idn_"),
          userId: byEmail.id,
          provider: identity.provider,
          providerSubject: identity.subject,
          email: identity.email,
          createdAt: now,
          updatedAt: now
        });
        await tx
          .update(pgOpenDropSchema.users)
          .set({
            email: identity.email,
            name: identity.name ?? byEmail.name,
            avatarUrl: identity.avatarUrl ?? byEmail.avatarUrl,
            updatedAt: now
          })
          .where(eq(pgOpenDropSchema.users.id, byEmail.id));
        const [user] = await tx.select().from(pgOpenDropSchema.users).where(eq(pgOpenDropSchema.users.id, byEmail.id)).limit(1);
        if (!user) throw new Error("User not found.");
        return user;
      }

      const now = nowIso();
      const userId = randomId("usr_");
      const namespace = await this.allocateNamespace(identity.email);
      await tx.insert(pgOpenDropSchema.users).values({
        id: userId,
        email: identity.email,
        name: identity.name ?? null,
        avatarUrl: identity.avatarUrl ?? null,
        defaultNamespace: namespace,
        createdAt: now,
        updatedAt: now
      });
      await tx.insert(pgOpenDropSchema.identities).values({
        id: randomId("idn_"),
        userId,
        provider: identity.provider,
        providerSubject: identity.subject,
        email: identity.email,
        createdAt: now,
        updatedAt: now
      });
      await tx.insert(pgOpenDropSchema.namespaces).values({ id: randomId("nsp_"), name: namespace, ownerUserId: userId, createdAt: now });
      const [user] = await tx.select().from(pgOpenDropSchema.users).where(eq(pgOpenDropSchema.users.id, userId)).limit(1);
      if (!user) throw new Error("User not found.");
      return user;
    });
  }

  async linkIdentityToEmail(identity: IdentityInput): Promise<UserRecord | null> {
    return this.orm.transaction(async (tx) => {
      const now = nowIso();
      const [existingIdentity] = await tx
        .select({ user: pgOpenDropSchema.users })
        .from(pgOpenDropSchema.identities)
        .innerJoin(pgOpenDropSchema.users, eq(pgOpenDropSchema.identities.userId, pgOpenDropSchema.users.id))
        .where(and(eq(pgOpenDropSchema.identities.provider, identity.provider), eq(pgOpenDropSchema.identities.providerSubject, identity.subject)))
        .limit(1);
      if (existingIdentity) {
        await tx
          .update(pgOpenDropSchema.users)
          .set({
            email: identity.email,
            name: identity.name ?? existingIdentity.user.name,
            avatarUrl: identity.avatarUrl ?? existingIdentity.user.avatarUrl,
            updatedAt: now
          })
          .where(eq(pgOpenDropSchema.users.id, existingIdentity.user.id));
        const [user] = await tx.select().from(pgOpenDropSchema.users).where(eq(pgOpenDropSchema.users.id, existingIdentity.user.id)).limit(1);
        if (!user) throw new Error("User not found.");
        return user;
      }

      const [user] = await tx.select().from(pgOpenDropSchema.users).where(eq(pgOpenDropSchema.users.email, identity.email)).limit(1);
      if (!user) return null;
      await tx.insert(pgOpenDropSchema.identities).values({
        id: randomId("idn_"),
        userId: user.id,
        provider: identity.provider,
        providerSubject: identity.subject,
        email: identity.email,
        createdAt: now,
        updatedAt: now
      });
      await tx
        .update(pgOpenDropSchema.users)
        .set({ name: identity.name ?? user.name, avatarUrl: identity.avatarUrl ?? user.avatarUrl, updatedAt: now })
        .where(eq(pgOpenDropSchema.users.id, user.id));
      const [updatedUser] = await tx.select().from(pgOpenDropSchema.users).where(eq(pgOpenDropSchema.users.id, user.id)).limit(1);
      if (!updatedUser) throw new Error("User not found.");
      return updatedUser;
    });
  }

  async getUserByIdentity(provider: IdentityInput["provider"], subject: string): Promise<UserRecord | null> {
    const [row] = await this.orm
      .select({ user: pgOpenDropSchema.users })
      .from(pgOpenDropSchema.identities)
      .innerJoin(pgOpenDropSchema.users, eq(pgOpenDropSchema.identities.userId, pgOpenDropSchema.users.id))
      .where(and(eq(pgOpenDropSchema.identities.provider, provider), eq(pgOpenDropSchema.identities.providerSubject, subject)))
      .limit(1);
    return row?.user ?? null;
  }

  async getUserById(id: string): Promise<UserRecord | null> {
    const rows = await this.orm.select().from(pgOpenDropSchema.users).where(eq(pgOpenDropSchema.users.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async getUserByCliTokenHash(tokenHash: string): Promise<UserRecord | null> {
    const [row] = await this.orm
      .select({ user: pgOpenDropSchema.users })
      .from(pgOpenDropSchema.cliTokens)
      .innerJoin(pgOpenDropSchema.users, eq(pgOpenDropSchema.cliTokens.userId, pgOpenDropSchema.users.id))
      .where(and(eq(pgOpenDropSchema.cliTokens.tokenHash, tokenHash), isNull(pgOpenDropSchema.cliTokens.revokedAt)))
      .limit(1);
    if (!row) return null;
    await this.orm.update(pgOpenDropSchema.cliTokens).set({ lastUsedAt: nowIso() }).where(eq(pgOpenDropSchema.cliTokens.tokenHash, tokenHash));
    return row.user;
  }

  async createCliToken(userId: string, tokenHash: string, label?: string, deviceName?: string, userAgent?: string): Promise<string> {
    const id = randomId("tok_");
    await this.orm.insert(pgOpenDropSchema.cliTokens).values({
      id,
      userId,
      tokenHash,
      label: label ?? null,
      deviceName: deviceName ?? null,
      userAgent: userAgent ?? null,
      createdAt: nowIso()
    });
    return id;
  }

  async listCliTokens(userId: string) {
    return this.orm
      .select({
        id: pgOpenDropSchema.cliTokens.id,
        label: pgOpenDropSchema.cliTokens.label,
        deviceName: pgOpenDropSchema.cliTokens.deviceName,
        createdAt: pgOpenDropSchema.cliTokens.createdAt,
        lastUsedAt: pgOpenDropSchema.cliTokens.lastUsedAt,
        revokedAt: pgOpenDropSchema.cliTokens.revokedAt
      })
      .from(pgOpenDropSchema.cliTokens)
      .where(eq(pgOpenDropSchema.cliTokens.userId, userId))
      .orderBy(desc(pgOpenDropSchema.cliTokens.createdAt));
  }

  async revokeCliToken(userId: string, tokenId: string): Promise<void> {
    await this.orm
      .update(pgOpenDropSchema.cliTokens)
      .set({ revokedAt: nowIso() })
      .where(and(eq(pgOpenDropSchema.cliTokens.id, tokenId), eq(pgOpenDropSchema.cliTokens.userId, userId)));
  }

  async createDeviceAuthorization(input: {
    deviceCodeHash: string;
    userCode: string;
    label?: string;
    deviceName?: string;
    userAgent?: string;
    expiresAt: string;
  }) {
    const id = randomId("dev_");
    await this.orm.insert(pgOpenDropSchema.deviceAuthorizations).values({
      id,
      deviceCodeHash: input.deviceCodeHash,
      userCode: input.userCode,
      status: "pending",
      label: input.label ?? null,
      deviceName: input.deviceName ?? null,
      userAgent: input.userAgent ?? null,
      createdAt: nowIso(),
      expiresAt: input.expiresAt
    });
    return { id, userCode: input.userCode, expiresAt: input.expiresAt };
  }

  async getDeviceAuthorizationByUserCode(userCode: string) {
    const [row] = await this.orm
      .select({
        id: pgOpenDropSchema.deviceAuthorizations.id,
        userCode: pgOpenDropSchema.deviceAuthorizations.userCode,
        status: pgOpenDropSchema.deviceAuthorizations.status,
        label: pgOpenDropSchema.deviceAuthorizations.label,
        deviceName: pgOpenDropSchema.deviceAuthorizations.deviceName,
        expiresAt: pgOpenDropSchema.deviceAuthorizations.expiresAt
      })
      .from(pgOpenDropSchema.deviceAuthorizations)
      .where(eq(pgOpenDropSchema.deviceAuthorizations.userCode, userCode))
      .limit(1);
    return row ?? null;
  }

  async approveDeviceAuthorization(userCode: string, userId: string, tokenHash: string, tokenPlain: string): Promise<void> {
    await this.orm.transaction(async (tx) => {
      const [row] = await tx.select().from(pgOpenDropSchema.deviceAuthorizations).where(eq(pgOpenDropSchema.deviceAuthorizations.userCode, userCode)).limit(1);
      if (!row) throw new Error("Device code not found.");
      if (row.status !== "pending") throw new Error("Device code is not pending.");
      if (new Date(row.expiresAt).getTime() < Date.now()) throw new Error("Device code expired.");
      const tokenId = randomId("tok_");
      const now = nowIso();
      await tx.insert(pgOpenDropSchema.cliTokens).values({
        id: tokenId,
        userId,
        tokenHash,
        label: row.label,
        deviceName: row.deviceName,
        userAgent: row.userAgent,
        createdAt: now
      });
      await tx
        .update(pgOpenDropSchema.deviceAuthorizations)
        .set({ status: "approved", userId, tokenHash, tokenPlain, approvedAt: now })
        .where(eq(pgOpenDropSchema.deviceAuthorizations.id, row.id));
    });
  }

  async rejectDeviceAuthorization(userCode: string, userId: string): Promise<void> {
    await this.orm
      .update(pgOpenDropSchema.deviceAuthorizations)
      .set({ status: "rejected", userId, rejectedAt: nowIso() })
      .where(and(eq(pgOpenDropSchema.deviceAuthorizations.userCode, userCode), eq(pgOpenDropSchema.deviceAuthorizations.status, "pending")));
  }

  async exchangeDeviceAuthorization(deviceCodeHash: string) {
    return this.orm.transaction(async (tx) => {
      const [row] = await tx
        .select({
          id: pgOpenDropSchema.deviceAuthorizations.id,
          status: pgOpenDropSchema.deviceAuthorizations.status,
          userId: pgOpenDropSchema.deviceAuthorizations.userId,
          tokenPlain: pgOpenDropSchema.deviceAuthorizations.tokenPlain,
          expiresAt: pgOpenDropSchema.deviceAuthorizations.expiresAt
        })
        .from(pgOpenDropSchema.deviceAuthorizations)
        .where(eq(pgOpenDropSchema.deviceAuthorizations.deviceCodeHash, deviceCodeHash))
        .limit(1);
      if (!row) return null;
      if (row.status === "approved" && row.tokenPlain) {
        await tx.update(pgOpenDropSchema.deviceAuthorizations).set({ tokenPlain: null }).where(eq(pgOpenDropSchema.deviceAuthorizations.id, row.id));
      }
      return {
        status: row.status,
        userId: row.userId,
        tokenPlain: row.tokenPlain,
        expiresAt: row.expiresAt
      };
    });
  }

  async getNamespace(name: string): Promise<NamespaceRecord | null> {
    const rows = await this.orm.select().from(pgOpenDropSchema.namespaces).where(eq(pgOpenDropSchema.namespaces.name, name)).limit(1);
    return rows[0] ?? null;
  }

  async listNamespacesForUser(userId: string): Promise<NamespaceAccessRecord[]> {
    const owned = await this.orm.select().from(pgOpenDropSchema.namespaces).where(eq(pgOpenDropSchema.namespaces.ownerUserId, userId));
    const published = await this.orm
      .select({
        id: pgOpenDropSchema.namespaces.id,
        name: pgOpenDropSchema.namespaces.name,
        ownerUserId: pgOpenDropSchema.namespaces.ownerUserId,
        createdAt: pgOpenDropSchema.namespaces.createdAt,
        role: pgOpenDropSchema.namespaceMembers.role
      })
      .from(pgOpenDropSchema.namespaceMembers)
      .innerJoin(pgOpenDropSchema.namespaces, eq(pgOpenDropSchema.namespaceMembers.namespaceId, pgOpenDropSchema.namespaces.id))
      .where(and(eq(pgOpenDropSchema.namespaceMembers.userId, userId), ne(pgOpenDropSchema.namespaces.ownerUserId, userId)));
    return namespaceAccessRecords(owned, published);
  }

  async createNamespace(name: string, ownerUserId: string): Promise<NamespaceAccessRecord> {
    const validation = validateNamespace(name);
    if (validation) throw new Error(validation);
    const id = randomId("nsp_");
    try {
      await this.orm.insert(pgOpenDropSchema.namespaces).values({ id, name, ownerUserId, createdAt: nowIso() });
    } catch (error) {
      if (String(error).toLowerCase().includes("unique")) throw new Error("Namespace already exists.");
      throw error;
    }
    const [namespace] = await this.orm.select().from(pgOpenDropSchema.namespaces).where(eq(pgOpenDropSchema.namespaces.id, id)).limit(1);
    if (!namespace) throw new Error("Expected database row was not found.");
    return { ...namespace, role: "owner" };
  }

  async listNamespaceMembers(namespace: string, ownerUserId: string): Promise<NamespaceMemberRecord[]> {
    const record = await this.getOwnedNamespace(namespace, ownerUserId);
    const [owner] = await this.orm
      .select({
        userId: pgOpenDropSchema.users.id,
        email: pgOpenDropSchema.users.email,
        name: pgOpenDropSchema.users.name
      })
      .from(pgOpenDropSchema.users)
      .where(eq(pgOpenDropSchema.users.id, record.ownerUserId))
      .limit(1);
    if (!owner) throw new Error("Expected database row was not found.");
    const members = await this.orm
      .select({
        namespaceId: pgOpenDropSchema.namespaceMembers.namespaceId,
        userId: pgOpenDropSchema.namespaceMembers.userId,
        email: pgOpenDropSchema.users.email,
        name: pgOpenDropSchema.users.name,
        role: pgOpenDropSchema.namespaceMembers.role,
        createdAt: pgOpenDropSchema.namespaceMembers.createdAt
      })
      .from(pgOpenDropSchema.namespaceMembers)
      .innerJoin(pgOpenDropSchema.users, eq(pgOpenDropSchema.namespaceMembers.userId, pgOpenDropSchema.users.id))
      .where(eq(pgOpenDropSchema.namespaceMembers.namespaceId, record.id))
      .orderBy(asc(pgOpenDropSchema.users.email));
    return [
      { namespaceId: record.id, userId: owner.userId, email: owner.email, name: owner.name, role: "owner", createdAt: record.createdAt },
      ...members.map(namespaceMemberRecord)
    ];
  }

  async addNamespacePublisher(namespace: string, ownerUserId: string, email: string): Promise<NamespaceMemberRecord> {
    const record = await this.getOwnedNamespace(namespace, ownerUserId);
    const [user] = await this.orm.select().from(pgOpenDropSchema.users).where(eq(pgOpenDropSchema.users.email, email)).limit(1);
    if (!user) throw new Error("User not found.");
    if (user.id === ownerUserId) {
      return {
        namespaceId: record.id,
        userId: user.id,
        email: user.email,
        name: user.name,
        role: "owner",
        createdAt: record.createdAt
      };
    }
    await this.orm
      .insert(pgOpenDropSchema.namespaceMembers)
      .values({ namespaceId: record.id, userId: user.id, role: "publisher", createdAt: nowIso() })
      .onConflictDoUpdate({
        target: [pgOpenDropSchema.namespaceMembers.namespaceId, pgOpenDropSchema.namespaceMembers.userId],
        set: { role: "publisher" }
      });
    const [row] = await this.orm
      .select({
        namespaceId: pgOpenDropSchema.namespaceMembers.namespaceId,
        userId: pgOpenDropSchema.namespaceMembers.userId,
        email: pgOpenDropSchema.users.email,
        name: pgOpenDropSchema.users.name,
        role: pgOpenDropSchema.namespaceMembers.role,
        createdAt: pgOpenDropSchema.namespaceMembers.createdAt
      })
      .from(pgOpenDropSchema.namespaceMembers)
      .innerJoin(pgOpenDropSchema.users, eq(pgOpenDropSchema.namespaceMembers.userId, pgOpenDropSchema.users.id))
      .where(and(eq(pgOpenDropSchema.namespaceMembers.namespaceId, record.id), eq(pgOpenDropSchema.namespaceMembers.userId, user.id)))
      .limit(1);
    if (!row) throw new Error("Expected database row was not found.");
    return namespaceMemberRecord(row);
  }

  async removeNamespacePublisher(namespace: string, ownerUserId: string, memberUserId: string): Promise<void> {
    const record = await this.getOwnedNamespace(namespace, ownerUserId);
    if (memberUserId === ownerUserId) throw new Error("Namespace owner cannot be removed.");
    await this.orm
      .delete(pgOpenDropSchema.namespaceMembers)
      .where(
        and(
          eq(pgOpenDropSchema.namespaceMembers.namespaceId, record.id),
          eq(pgOpenDropSchema.namespaceMembers.userId, memberUserId),
          eq(pgOpenDropSchema.namespaceMembers.role, "publisher")
        )
      );
  }

  async userCanPublishNamespace(userId: string, namespace: string): Promise<boolean> {
    const [owned] = await this.orm
      .select({ id: pgOpenDropSchema.namespaces.id })
      .from(pgOpenDropSchema.namespaces)
      .where(and(eq(pgOpenDropSchema.namespaces.name, namespace), eq(pgOpenDropSchema.namespaces.ownerUserId, userId)))
      .limit(1);
    if (owned) return true;
    const [member] = await this.orm
      .select({ userId: pgOpenDropSchema.namespaceMembers.userId })
      .from(pgOpenDropSchema.namespaceMembers)
      .innerJoin(pgOpenDropSchema.namespaces, eq(pgOpenDropSchema.namespaceMembers.namespaceId, pgOpenDropSchema.namespaces.id))
      .where(
        and(
          eq(pgOpenDropSchema.namespaces.name, namespace),
          eq(pgOpenDropSchema.namespaceMembers.userId, userId),
          inArray(pgOpenDropSchema.namespaceMembers.role, ["owner", "publisher"])
        )
      )
      .limit(1);
    return Boolean(member);
  }

  async getDeploymentFamily(namespace: string, slug: string): Promise<DeploymentFamilyRecord | null> {
    const [row] = await this.orm
      .select()
      .from(pgOpenDropSchema.deploymentFamilies)
      .where(and(eq(pgOpenDropSchema.deploymentFamilies.namespaceName, namespace), eq(pgOpenDropSchema.deploymentFamilies.slug, slug)))
      .limit(1);
    return row ? mapDeploymentFamily(row) : null;
  }

  async createDeploymentVersion(input: CreateVersionInput): Promise<DeploymentWithVersion> {
    return this.orm.transaction(async (tx) => {
      const [namespace] = await tx.select().from(pgOpenDropSchema.namespaces).where(eq(pgOpenDropSchema.namespaces.name, input.namespace)).limit(1);
      if (!namespace) throw new Error("Namespace not found.");
      const [ownedNamespace] = await tx
        .select({ id: pgOpenDropSchema.namespaces.id })
        .from(pgOpenDropSchema.namespaces)
        .where(and(eq(pgOpenDropSchema.namespaces.name, input.namespace), eq(pgOpenDropSchema.namespaces.ownerUserId, input.ownerUserId)))
        .limit(1);
      const [publisherNamespace] = ownedNamespace
        ? [ownedNamespace]
        : await tx
            .select({ id: pgOpenDropSchema.namespaceMembers.namespaceId })
            .from(pgOpenDropSchema.namespaceMembers)
            .innerJoin(pgOpenDropSchema.namespaces, eq(pgOpenDropSchema.namespaceMembers.namespaceId, pgOpenDropSchema.namespaces.id))
            .where(
              and(
                eq(pgOpenDropSchema.namespaces.name, input.namespace),
                eq(pgOpenDropSchema.namespaceMembers.userId, input.ownerUserId),
                inArray(pgOpenDropSchema.namespaceMembers.role, ["owner", "publisher"])
              )
            )
            .limit(1);
      if (!publisherNamespace) {
        throw new Error("User cannot publish to this namespace.");
      }

      const now = nowIso();
      let [family] = await tx
        .select()
        .from(pgOpenDropSchema.deploymentFamilies)
        .where(and(eq(pgOpenDropSchema.deploymentFamilies.namespaceName, input.namespace), eq(pgOpenDropSchema.deploymentFamilies.slug, input.slug)))
        .limit(1);
      if (!family) {
        const familyId = randomId("dep_");
        await tx.insert(pgOpenDropSchema.deploymentFamilies).values({
          id: familyId,
          namespaceId: namespace.id,
          namespaceName: input.namespace,
          slug: input.slug,
          ownerUserId: input.ownerUserId,
          latestVersionId: null,
          visibility: input.visibility,
          createdAt: now,
          updatedAt: now
        });
        [family] = await tx.select().from(pgOpenDropSchema.deploymentFamilies).where(eq(pgOpenDropSchema.deploymentFamilies.id, familyId)).limit(1);
      }
      if (!family) throw new Error("Deployment family could not be created.");
      if (family.ownerUserId !== input.ownerUserId) {
        throw new Error("Only the slug owner can create a new version.");
      }

      const [latestVersion] = await tx
        .select({ versionNumber: pgOpenDropSchema.deploymentVersions.versionNumber })
        .from(pgOpenDropSchema.deploymentVersions)
        .where(eq(pgOpenDropSchema.deploymentVersions.familyId, family.id))
        .orderBy(desc(pgOpenDropSchema.deploymentVersions.versionNumber))
        .limit(1);
      const versionId = input.versionId ?? randomId("ver_");
      await tx.insert(pgOpenDropSchema.deploymentVersions).values({
        id: versionId,
        familyId: family.id,
        versionNumber: (latestVersion?.versionNumber ?? 0) + 1,
        createdByUserId: input.ownerUserId,
        manifestHash: input.manifestHash,
        fileCount: input.files.length,
        totalBytes: input.files.reduce((sum, file) => sum + file.size, 0),
        createdAt: now
      });
      if (input.files.length > 0) {
        await tx.insert(pgOpenDropSchema.deploymentFiles).values(
          input.files.map((file) => ({
            id: randomId("fil_"),
            versionId,
            path: file.path,
            size: file.size,
            sha256: file.sha256,
            contentType: file.contentType,
            lineCount: file.lineCount ?? null,
            storageKey: file.storageKey
          }))
        );
      }
      await tx
        .update(pgOpenDropSchema.deploymentFamilies)
        .set({ latestVersionId: versionId, visibility: input.visibility, updatedAt: now })
        .where(eq(pgOpenDropSchema.deploymentFamilies.id, family.id));
      const [nextFamily] = await tx.select().from(pgOpenDropSchema.deploymentFamilies).where(eq(pgOpenDropSchema.deploymentFamilies.id, family.id)).limit(1);
      const [version] = await tx.select().from(pgOpenDropSchema.deploymentVersions).where(eq(pgOpenDropSchema.deploymentVersions.id, versionId)).limit(1);
      if (!nextFamily || !version) throw new Error("Deployment version could not be created.");
      return {
        family: mapDeploymentFamily(nextFamily),
        version: mapDeploymentVersion(version)
      };
    });
  }

  async setDeploymentVisibility(namespace: string, slug: string, visibility: Visibility, userId: string): Promise<DeploymentFamilyRecord> {
    const family = await this.getDeploymentFamily(namespace, slug);
    if (!family) throw new Error("Deployment not found.");
    if (family.ownerUserId !== userId) throw new Error("Only the owner can change visibility.");
    await this.orm
      .update(pgOpenDropSchema.deploymentFamilies)
      .set({ visibility, updatedAt: nowIso() })
      .where(eq(pgOpenDropSchema.deploymentFamilies.id, family.id));
    const [row] = await this.orm.select().from(pgOpenDropSchema.deploymentFamilies).where(eq(pgOpenDropSchema.deploymentFamilies.id, family.id)).limit(1);
    if (!row) throw new Error("Deployment not found.");
    return mapDeploymentFamily(row);
  }

  async restoreDeploymentVersion(namespace: string, slug: string, versionId: string, userId: string): Promise<DeploymentWithVersion> {
    const family = await this.getDeploymentFamily(namespace, slug);
    if (!family) throw new Error("Deployment not found.");
    if (family.ownerUserId !== userId) throw new Error("Only the owner can restore a version.");
    const [versionRow] = await this.orm
      .select()
      .from(pgOpenDropSchema.deploymentVersions)
      .where(and(eq(pgOpenDropSchema.deploymentVersions.id, versionId), eq(pgOpenDropSchema.deploymentVersions.familyId, family.id)))
      .limit(1);
    if (!versionRow) throw new Error("Version not found.");
    await this.orm
      .update(pgOpenDropSchema.deploymentFamilies)
      .set({ latestVersionId: versionId, updatedAt: nowIso() })
      .where(eq(pgOpenDropSchema.deploymentFamilies.id, family.id));
    const [familyRow] = await this.orm.select().from(pgOpenDropSchema.deploymentFamilies).where(eq(pgOpenDropSchema.deploymentFamilies.id, family.id)).limit(1);
    if (!familyRow) throw new Error("Deployment not found.");
    return {
      family: mapDeploymentFamily(familyRow),
      version: mapDeploymentVersion(versionRow)
    };
  }

  async getDeploymentVersion(namespace: string, slug: string, versionId?: string): Promise<DeploymentWithVersion | null> {
    const family = await this.getDeploymentFamily(namespace, slug);
    if (!family) return null;
    const selectedVersionId = versionId ?? family.latestVersionId;
    if (!selectedVersionId) return null;
    const [versionRow] = await this.orm
      .select()
      .from(pgOpenDropSchema.deploymentVersions)
      .where(and(eq(pgOpenDropSchema.deploymentVersions.id, selectedVersionId), eq(pgOpenDropSchema.deploymentVersions.familyId, family.id)))
      .limit(1);
    if (!versionRow) return null;
    return { family, version: mapDeploymentVersion(versionRow) };
  }

  async listDeploymentVersions(namespace: string, slug: string): Promise<DeploymentVersionRecord[]> {
    const family = await this.getDeploymentFamily(namespace, slug);
    if (!family) return [];
    const rows = await this.orm
      .select()
      .from(pgOpenDropSchema.deploymentVersions)
      .where(eq(pgOpenDropSchema.deploymentVersions.familyId, family.id))
      .orderBy(desc(pgOpenDropSchema.deploymentVersions.versionNumber));
    return rows.map(mapDeploymentVersion);
  }

  async listDeploymentFiles(versionId: string): Promise<DeploymentFileRecord[]> {
    const rows = await this.orm
      .select()
      .from(pgOpenDropSchema.deploymentFiles)
      .where(eq(pgOpenDropSchema.deploymentFiles.versionId, versionId))
      .orderBy(asc(pgOpenDropSchema.deploymentFiles.path));
    return rows.map(mapDeploymentFile);
  }

  async getDeploymentFile(versionId: string, path: string): Promise<DeploymentFileRecord | null> {
    const [row] = await this.orm
      .select()
      .from(pgOpenDropSchema.deploymentFiles)
      .where(and(eq(pgOpenDropSchema.deploymentFiles.versionId, versionId), eq(pgOpenDropSchema.deploymentFiles.path, path)))
      .limit(1);
    return row ? mapDeploymentFile(row) : null;
  }

  async createAnnotation(namespace: string, slug: string, input: AnnotationInput, userId: string): Promise<AnnotationRecord> {
    const deployment = await this.getDeploymentVersion(namespace, slug, input.versionId);
    if (!deployment) throw new Error("Deployment not found.");
    if (input.parentAnnotationId) {
      await this.assertParentAnnotation(deployment.family.id, deployment.version.id, input.pagePath, input.parentAnnotationId);
    }
    const now = nowIso();
    const id = randomId("ann_");
    await this.orm.insert(pgOpenDropSchema.annotations).values(annotationInsertValues(deployment, input, userId, id, now));
    const [row] = await this.orm.select().from(pgOpenDropSchema.annotations).where(eq(pgOpenDropSchema.annotations.id, id)).limit(1);
    if (!row) throw new Error("Annotation not found.");
    return mapDbAnnotation(row);
  }

  async setAnnotationResolved(namespace: string, slug: string, annotationId: string, resolved: boolean, _userId: string): Promise<AnnotationRecord> {
    const family = await this.getDeploymentFamily(namespace, slug);
    if (!family) throw new Error("Deployment not found.");
    const now = nowIso();
    await this.orm
      .update(pgOpenDropSchema.annotations)
      .set({ resolvedAt: resolved ? now : null, updatedAt: now })
      .where(and(eq(pgOpenDropSchema.annotations.id, annotationId), eq(pgOpenDropSchema.annotations.familyId, family.id)));
    const [row] = await this.orm
      .select()
      .from(pgOpenDropSchema.annotations)
      .where(and(eq(pgOpenDropSchema.annotations.id, annotationId), eq(pgOpenDropSchema.annotations.familyId, family.id)))
      .limit(1);
    if (!row) throw new Error("Annotation not found.");
    return mapDbAnnotation(row);
  }

  async listAnnotations(namespace: string, slug: string, versionId: string, pagePath?: string): Promise<AnnotationRecord[]> {
    const family = await this.getDeploymentFamily(namespace, slug);
    if (!family) return [];
    const where = pagePath
      ? and(eq(pgOpenDropSchema.annotations.familyId, family.id), eq(pgOpenDropSchema.annotations.versionId, versionId), eq(pgOpenDropSchema.annotations.pagePath, pagePath))
      : and(eq(pgOpenDropSchema.annotations.familyId, family.id), eq(pgOpenDropSchema.annotations.versionId, versionId));
    const rows = await this.orm.select().from(pgOpenDropSchema.annotations).where(where).orderBy(asc(pgOpenDropSchema.annotations.createdAt));
    return rows.map(mapDbAnnotation);
  }

  private async getOwnedNamespace(name: string, ownerUserId: string): Promise<NamespaceRecord> {
    const namespace = await this.getNamespace(name);
    if (!namespace) throw new Error("Namespace not found.");
    if (namespace.ownerUserId !== ownerUserId) throw new Error("Only the namespace owner can manage publishers.");
    return namespace;
  }

  private async assertParentAnnotation(familyId: string, versionId: string, pagePath: string, parentAnnotationId: string): Promise<void> {
    const [parent] = await this.orm
      .select({ id: pgOpenDropSchema.annotations.id })
      .from(pgOpenDropSchema.annotations)
      .where(
        and(
          eq(pgOpenDropSchema.annotations.id, parentAnnotationId),
          eq(pgOpenDropSchema.annotations.familyId, familyId),
          eq(pgOpenDropSchema.annotations.versionId, versionId),
          eq(pgOpenDropSchema.annotations.pagePath, pagePath)
        )
      )
      .limit(1);
    if (!parent) throw new Error("Parent annotation not found for this page version.");
  }

  private async allocateNamespace(email: string): Promise<string> {
    return allocateNamespaceForEmail(email, async (candidate) =>
      Boolean(
        (
          await this.orm
            .select({ id: pgOpenDropSchema.namespaces.id })
            .from(pgOpenDropSchema.namespaces)
            .where(eq(pgOpenDropSchema.namespaces.name, candidate))
            .limit(1)
        )[0]
      )
    );
  }

}

export function createPostgresRepository(databaseUrl: string): OpenDropRepository {
  return new PostgresOpenDropRepository(databaseUrl);
}
