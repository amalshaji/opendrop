import {
  nowIso,
  randomId,
  validateNamespace
} from "../core";
import { and, asc, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { AnnotationInput, Visibility } from "../core";
import type { CreateUploadSessionInput, CreateVersionInput, FinalizeUploadSessionClaim, OpenDropRepository, TransitionUploadSessionInput } from "./repository";
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
  UploadSessionRecord,
  UserRecord
} from "./types";
import {
  allocateNamespaceForEmail,
  annotationInsertValues,
  mapDbAnnotation,
  mapDeploymentFamily,
  mapDeploymentFile,
  mapDeploymentVersion,
  mapUploadSession,
  namespaceAccessRecords,
  namespaceMemberRecord,
  uploadSessionClaimResult
} from "./domain";
import { decideDeviceTokenExchange } from "./device-authorization";
import { sqliteOpenDropSchema } from "./schema";

export interface D1ResultLike {
  meta?: { changes?: number };
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results?: T[] }>;
  raw<T = unknown[]>(): Promise<T[]>;
  run(): Promise<D1ResultLike>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch(statements: D1PreparedStatementLike[]): Promise<D1ResultLike[]>;
  exec?(query: string): Promise<unknown>;
}

export class D1OpenDropRepository implements OpenDropRepository {
  private orm: ReturnType<typeof drizzle<typeof sqliteOpenDropSchema>>;

  constructor(private db: D1DatabaseLike) {
    this.orm = drizzle(db as any, { schema: sqliteOpenDropSchema });
  }

  async migrate(): Promise<void> {
    // D1 migrations are applied by Wrangler from packages/shared/migrations.
  }

  async getOrCreateUser(identity: IdentityInput): Promise<UserRecord> {
    const existingIdentity = await this.orm
      .select({ user: sqliteOpenDropSchema.users })
      .from(sqliteOpenDropSchema.identities)
      .innerJoin(sqliteOpenDropSchema.users, eq(sqliteOpenDropSchema.identities.userId, sqliteOpenDropSchema.users.id))
      .where(and(eq(sqliteOpenDropSchema.identities.provider, identity.provider), eq(sqliteOpenDropSchema.identities.providerSubject, identity.subject)))
      .get();
    if (existingIdentity) {
      const now = nowIso();
      await this.orm
        .update(sqliteOpenDropSchema.users)
        .set({
          email: identity.email,
          name: identity.name ?? existingIdentity.user.name,
          avatarUrl: identity.avatarUrl ?? existingIdentity.user.avatarUrl,
          updatedAt: now
        })
        .where(eq(sqliteOpenDropSchema.users.id, existingIdentity.user.id));
      const user = await this.getUserById(existingIdentity.user.id);
      if (!user) throw new Error("User not found.");
      return user;
    }

    const byEmail = await this.orm.select().from(sqliteOpenDropSchema.users).where(eq(sqliteOpenDropSchema.users.email, identity.email)).get();
    if (byEmail && identity.provider === "trusted-header") {
      throw new Error("A user with this email already exists but has a different trusted-header subject.");
    }
    if (byEmail) {
      const now = nowIso();
      await this.db.batch([
        this.db.prepare("insert into identities (id, user_id, provider, provider_subject, email, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)")
          .bind(randomId("idn_"), byEmail.id, identity.provider, identity.subject, identity.email, now, now),
        this.db.prepare("update users set email = ?, name = ?, avatar_url = ?, updated_at = ? where id = ?")
          .bind(identity.email, identity.name ?? byEmail.name, identity.avatarUrl ?? byEmail.avatarUrl, now, byEmail.id)
      ]);
      const user = await this.getUserById(byEmail.id);
      if (!user) throw new Error("User not found.");
      return user;
    }

    const now = nowIso();
    const userId = randomId("usr_");
    const namespace = await this.allocateNamespace(identity.email);
    await this.db.batch([
      this.db.prepare("insert into users (id, email, name, avatar_url, default_namespace, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)")
        .bind(userId, identity.email, identity.name ?? null, identity.avatarUrl ?? null, namespace, now, now),
      this.db.prepare("insert into identities (id, user_id, provider, provider_subject, email, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)")
        .bind(randomId("idn_"), userId, identity.provider, identity.subject, identity.email, now, now),
      this.db.prepare("insert into namespaces (id, name, owner_user_id, created_at) values (?, ?, ?, ?)")
        .bind(randomId("nsp_"), namespace, userId, now)
    ]);
    const user = await this.getUserById(userId);
    if (!user) throw new Error("User not found.");
    return user;
  }

  async linkIdentityToEmail(identity: IdentityInput): Promise<UserRecord | null> {
    const now = nowIso();
    const existingIdentity = await this.orm
      .select({ user: sqliteOpenDropSchema.users })
      .from(sqliteOpenDropSchema.identities)
      .innerJoin(sqliteOpenDropSchema.users, eq(sqliteOpenDropSchema.identities.userId, sqliteOpenDropSchema.users.id))
      .where(and(eq(sqliteOpenDropSchema.identities.provider, identity.provider), eq(sqliteOpenDropSchema.identities.providerSubject, identity.subject)))
      .get();
    if (existingIdentity) {
      await this.orm
        .update(sqliteOpenDropSchema.users)
        .set({
          email: identity.email,
          name: identity.name ?? existingIdentity.user.name,
          avatarUrl: identity.avatarUrl ?? existingIdentity.user.avatarUrl,
          updatedAt: now
        })
        .where(eq(sqliteOpenDropSchema.users.id, existingIdentity.user.id));
      return this.getUserById(existingIdentity.user.id);
    }

    const user = await this.orm.select().from(sqliteOpenDropSchema.users).where(eq(sqliteOpenDropSchema.users.email, identity.email)).get();
    if (!user) return null;
    await this.db.batch([
      this.db.prepare("insert into identities (id, user_id, provider, provider_subject, email, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)")
        .bind(randomId("idn_"), user.id, identity.provider, identity.subject, identity.email, now, now),
      this.db.prepare("update users set name = ?, avatar_url = ?, updated_at = ? where id = ?")
        .bind(identity.name ?? user.name, identity.avatarUrl ?? user.avatarUrl, now, user.id)
    ]);
    return this.getUserById(user.id);
  }

  async getUserByIdentity(provider: IdentityInput["provider"], subject: string): Promise<UserRecord | null> {
    const row = await this.orm
      .select({ user: sqliteOpenDropSchema.users })
      .from(sqliteOpenDropSchema.identities)
      .innerJoin(sqliteOpenDropSchema.users, eq(sqliteOpenDropSchema.identities.userId, sqliteOpenDropSchema.users.id))
      .where(and(eq(sqliteOpenDropSchema.identities.provider, provider), eq(sqliteOpenDropSchema.identities.providerSubject, subject)))
      .get();
    return row?.user ?? null;
  }

  async getUserById(id: string): Promise<UserRecord | null> {
    return (await this.orm.select().from(sqliteOpenDropSchema.users).where(eq(sqliteOpenDropSchema.users.id, id)).get()) ?? null;
  }

  async getUserByCliTokenHash(tokenHash: string): Promise<UserRecord | null> {
    const row = await this.orm
      .select({ user: sqliteOpenDropSchema.users })
      .from(sqliteOpenDropSchema.cliTokens)
      .innerJoin(sqliteOpenDropSchema.users, eq(sqliteOpenDropSchema.cliTokens.userId, sqliteOpenDropSchema.users.id))
      .where(and(eq(sqliteOpenDropSchema.cliTokens.tokenHash, tokenHash), isNull(sqliteOpenDropSchema.cliTokens.revokedAt)))
      .get();
    if (!row) return null;
    await this.orm.update(sqliteOpenDropSchema.cliTokens).set({ lastUsedAt: nowIso() }).where(eq(sqliteOpenDropSchema.cliTokens.tokenHash, tokenHash));
    return row.user;
  }

  async createCliToken(userId: string, tokenHash: string, label?: string, deviceName?: string, userAgent?: string): Promise<string> {
    const id = randomId("tok_");
    await this.orm.insert(sqliteOpenDropSchema.cliTokens).values({
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
        id: sqliteOpenDropSchema.cliTokens.id,
        label: sqliteOpenDropSchema.cliTokens.label,
        deviceName: sqliteOpenDropSchema.cliTokens.deviceName,
        createdAt: sqliteOpenDropSchema.cliTokens.createdAt,
        lastUsedAt: sqliteOpenDropSchema.cliTokens.lastUsedAt,
        revokedAt: sqliteOpenDropSchema.cliTokens.revokedAt
      })
      .from(sqliteOpenDropSchema.cliTokens)
      .where(eq(sqliteOpenDropSchema.cliTokens.userId, userId))
      .orderBy(desc(sqliteOpenDropSchema.cliTokens.createdAt));
  }

  async revokeCliToken(userId: string, tokenId: string): Promise<void> {
    await this.orm
      .update(sqliteOpenDropSchema.cliTokens)
      .set({ revokedAt: nowIso() })
      .where(and(eq(sqliteOpenDropSchema.cliTokens.id, tokenId), eq(sqliteOpenDropSchema.cliTokens.userId, userId)));
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
    await this.orm.insert(sqliteOpenDropSchema.deviceAuthorizations).values({
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
    return (
      (await this.orm
        .select({
          id: sqliteOpenDropSchema.deviceAuthorizations.id,
          userCode: sqliteOpenDropSchema.deviceAuthorizations.userCode,
          status: sqliteOpenDropSchema.deviceAuthorizations.status,
          label: sqliteOpenDropSchema.deviceAuthorizations.label,
          deviceName: sqliteOpenDropSchema.deviceAuthorizations.deviceName,
          expiresAt: sqliteOpenDropSchema.deviceAuthorizations.expiresAt
        })
        .from(sqliteOpenDropSchema.deviceAuthorizations)
        .where(eq(sqliteOpenDropSchema.deviceAuthorizations.userCode, userCode))
        .get()) ?? null
    );
  }

  async approveDeviceAuthorization(userCode: string, userId: string): Promise<void> {
    const row = await this.orm
      .select()
      .from(sqliteOpenDropSchema.deviceAuthorizations)
      .where(eq(sqliteOpenDropSchema.deviceAuthorizations.userCode, userCode))
      .get();
    if (!row) throw new Error("Device code not found.");
    if (row.status !== "pending") throw new Error("Device code is not pending.");
    if (new Date(row.expiresAt).getTime() < Date.now()) throw new Error("Device code expired.");
    const now = nowIso();
    const result = await this.db
      .prepare("update device_authorizations set status = 'approved', user_id = ?, approved_at = ? where id = ? and status = 'pending' and expires_at >= ?")
      .bind(userId, now, row.id, now)
      .run();
    if (result.meta?.changes !== 1) throw new Error("Device code is no longer pending.");
  }

  async rejectDeviceAuthorization(userCode: string, userId: string): Promise<void> {
    await this.orm
      .update(sqliteOpenDropSchema.deviceAuthorizations)
      .set({ status: "rejected", userId, rejectedAt: nowIso() })
      .where(and(eq(sqliteOpenDropSchema.deviceAuthorizations.userCode, userCode), eq(sqliteOpenDropSchema.deviceAuthorizations.status, "pending")));
  }

  async exchangeDeviceAuthorization(deviceCodeHash: string, tokenHash: string) {
    const row = await this.orm
      .select({
        id: sqliteOpenDropSchema.deviceAuthorizations.id,
        status: sqliteOpenDropSchema.deviceAuthorizations.status,
        userId: sqliteOpenDropSchema.deviceAuthorizations.userId,
        label: sqliteOpenDropSchema.deviceAuthorizations.label,
        deviceName: sqliteOpenDropSchema.deviceAuthorizations.deviceName,
        userAgent: sqliteOpenDropSchema.deviceAuthorizations.userAgent,
        expiresAt: sqliteOpenDropSchema.deviceAuthorizations.expiresAt
      })
      .from(sqliteOpenDropSchema.deviceAuthorizations)
      .where(eq(sqliteOpenDropSchema.deviceAuthorizations.deviceCodeHash, deviceCodeHash))
      .get();
    if (!row) return null;
    const decision = decideDeviceTokenExchange(row);
    if (decision.kind === "blocked") return decision.result;
    const authorization = decision.authorization;
    const now = nowIso();
    const [updateResult] = await this.db.batch([
      this.db.prepare("update device_authorizations set status = 'exchanged', token_hash = ? where id = ? and status = 'approved' and expires_at >= ?")
        .bind(tokenHash, authorization.id, now),
      this.db.prepare("insert into cli_tokens (id, user_id, token_hash, label, device_name, user_agent, created_at) select ?, user_id, ?, label, device_name, user_agent, ? from device_authorizations where id = ? and status = 'exchanged' and token_hash = ?")
        .bind(randomId("tok_"), tokenHash, now, authorization.id, tokenHash)
    ]);
    if (updateResult?.meta?.changes !== 1) {
      return { status: "already_exchanged" as const, expiresAt: authorization.expiresAt };
    }
    return { status: "issued" as const, expiresAt: authorization.expiresAt };
  }

  async getNamespace(name: string): Promise<NamespaceRecord | null> {
    return (await this.orm.select().from(sqliteOpenDropSchema.namespaces).where(eq(sqliteOpenDropSchema.namespaces.name, name)).get()) ?? null;
  }

  async listNamespacesForUser(userId: string): Promise<NamespaceAccessRecord[]> {
    const owned = await this.orm.select().from(sqliteOpenDropSchema.namespaces).where(eq(sqliteOpenDropSchema.namespaces.ownerUserId, userId)).all();
    const published = await this.orm
      .select({
        id: sqliteOpenDropSchema.namespaces.id,
        name: sqliteOpenDropSchema.namespaces.name,
        ownerUserId: sqliteOpenDropSchema.namespaces.ownerUserId,
        createdAt: sqliteOpenDropSchema.namespaces.createdAt,
        role: sqliteOpenDropSchema.namespaceMembers.role
      })
      .from(sqliteOpenDropSchema.namespaceMembers)
      .innerJoin(sqliteOpenDropSchema.namespaces, eq(sqliteOpenDropSchema.namespaceMembers.namespaceId, sqliteOpenDropSchema.namespaces.id))
      .where(and(eq(sqliteOpenDropSchema.namespaceMembers.userId, userId), ne(sqliteOpenDropSchema.namespaces.ownerUserId, userId)))
      .all();
    return namespaceAccessRecords(owned, published);
  }

  async createNamespace(name: string, ownerUserId: string): Promise<NamespaceAccessRecord> {
    const validation = validateNamespace(name);
    if (validation) throw new Error(validation);
    const id = randomId("nsp_");
    try {
      await this.orm.insert(sqliteOpenDropSchema.namespaces).values({ id, name, ownerUserId, createdAt: nowIso() });
    } catch (error) {
      if (String(error).toLowerCase().includes("unique")) throw new Error("Namespace already exists.");
      throw error;
    }
    const namespace = await this.orm.select().from(sqliteOpenDropSchema.namespaces).where(eq(sqliteOpenDropSchema.namespaces.id, id)).get();
    if (!namespace) throw new Error("Expected database row was not found.");
    return { ...namespace, role: "owner" };
  }

  async listNamespaceMembers(namespace: string, ownerUserId: string): Promise<NamespaceMemberRecord[]> {
    const record = await this.getOwnedNamespace(namespace, ownerUserId);
    const owner = await this.orm
      .select({
        userId: sqliteOpenDropSchema.users.id,
        email: sqliteOpenDropSchema.users.email,
        name: sqliteOpenDropSchema.users.name
      })
      .from(sqliteOpenDropSchema.users)
      .where(eq(sqliteOpenDropSchema.users.id, record.ownerUserId))
      .get();
    if (!owner) throw new Error("Expected database row was not found.");
    const members = await this.orm
      .select({
        namespaceId: sqliteOpenDropSchema.namespaceMembers.namespaceId,
        userId: sqliteOpenDropSchema.namespaceMembers.userId,
        email: sqliteOpenDropSchema.users.email,
        name: sqliteOpenDropSchema.users.name,
        role: sqliteOpenDropSchema.namespaceMembers.role,
        createdAt: sqliteOpenDropSchema.namespaceMembers.createdAt
      })
      .from(sqliteOpenDropSchema.namespaceMembers)
      .innerJoin(sqliteOpenDropSchema.users, eq(sqliteOpenDropSchema.namespaceMembers.userId, sqliteOpenDropSchema.users.id))
      .where(eq(sqliteOpenDropSchema.namespaceMembers.namespaceId, record.id))
      .orderBy(asc(sqliteOpenDropSchema.users.email))
      .all();
    return [
      { namespaceId: record.id, userId: owner.userId, email: owner.email, name: owner.name, role: "owner", createdAt: record.createdAt },
      ...members.map(namespaceMemberRecord)
    ];
  }

  async addNamespacePublisher(namespace: string, ownerUserId: string, email: string): Promise<NamespaceMemberRecord> {
    const record = await this.getOwnedNamespace(namespace, ownerUserId);
    const user = await this.orm.select().from(sqliteOpenDropSchema.users).where(eq(sqliteOpenDropSchema.users.email, email)).get();
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
      .insert(sqliteOpenDropSchema.namespaceMembers)
      .values({ namespaceId: record.id, userId: user.id, role: "publisher", createdAt: nowIso() })
      .onConflictDoUpdate({
        target: [sqliteOpenDropSchema.namespaceMembers.namespaceId, sqliteOpenDropSchema.namespaceMembers.userId],
        set: { role: "publisher" }
      });
    const row = await this.orm
      .select({
        namespaceId: sqliteOpenDropSchema.namespaceMembers.namespaceId,
        userId: sqliteOpenDropSchema.namespaceMembers.userId,
        email: sqliteOpenDropSchema.users.email,
        name: sqliteOpenDropSchema.users.name,
        role: sqliteOpenDropSchema.namespaceMembers.role,
        createdAt: sqliteOpenDropSchema.namespaceMembers.createdAt
      })
      .from(sqliteOpenDropSchema.namespaceMembers)
      .innerJoin(sqliteOpenDropSchema.users, eq(sqliteOpenDropSchema.namespaceMembers.userId, sqliteOpenDropSchema.users.id))
      .where(and(eq(sqliteOpenDropSchema.namespaceMembers.namespaceId, record.id), eq(sqliteOpenDropSchema.namespaceMembers.userId, user.id)))
      .get();
    if (!row) throw new Error("Expected database row was not found.");
    return namespaceMemberRecord(row);
  }

  async removeNamespacePublisher(namespace: string, ownerUserId: string, memberUserId: string): Promise<void> {
    const record = await this.getOwnedNamespace(namespace, ownerUserId);
    if (memberUserId === ownerUserId) throw new Error("Namespace owner cannot be removed.");
    await this.orm
      .delete(sqliteOpenDropSchema.namespaceMembers)
      .where(
        and(
          eq(sqliteOpenDropSchema.namespaceMembers.namespaceId, record.id),
          eq(sqliteOpenDropSchema.namespaceMembers.userId, memberUserId),
          eq(sqliteOpenDropSchema.namespaceMembers.role, "publisher")
        )
      );
  }

  async userCanPublishNamespace(userId: string, namespace: string): Promise<boolean> {
    const owned = await this.orm
      .select({ id: sqliteOpenDropSchema.namespaces.id })
      .from(sqliteOpenDropSchema.namespaces)
      .where(and(eq(sqliteOpenDropSchema.namespaces.name, namespace), eq(sqliteOpenDropSchema.namespaces.ownerUserId, userId)))
      .get();
    if (owned) return true;
    const member = await this.orm
      .select({ userId: sqliteOpenDropSchema.namespaceMembers.userId })
      .from(sqliteOpenDropSchema.namespaceMembers)
      .innerJoin(sqliteOpenDropSchema.namespaces, eq(sqliteOpenDropSchema.namespaceMembers.namespaceId, sqliteOpenDropSchema.namespaces.id))
      .where(
        and(
          eq(sqliteOpenDropSchema.namespaces.name, namespace),
          eq(sqliteOpenDropSchema.namespaceMembers.userId, userId),
          inArray(sqliteOpenDropSchema.namespaceMembers.role, ["owner", "publisher"])
        )
      )
      .get();
    return Boolean(member);
  }

  async getDeploymentFamily(namespace: string, slug: string): Promise<DeploymentFamilyRecord | null> {
    const row = await this.orm
      .select()
      .from(sqliteOpenDropSchema.deploymentFamilies)
      .where(and(eq(sqliteOpenDropSchema.deploymentFamilies.namespaceName, namespace), eq(sqliteOpenDropSchema.deploymentFamilies.slug, slug)))
      .get();
    return row ? mapDeploymentFamily(row) : null;
  }

  async listDeploymentsForUser(userId: string): Promise<DeploymentWithVersion[]> {
    const rows = await this.orm
      .select({
        family: sqliteOpenDropSchema.deploymentFamilies,
        version: sqliteOpenDropSchema.deploymentVersions
      })
      .from(sqliteOpenDropSchema.deploymentFamilies)
      .innerJoin(
        sqliteOpenDropSchema.deploymentVersions,
        eq(sqliteOpenDropSchema.deploymentFamilies.latestVersionId, sqliteOpenDropSchema.deploymentVersions.id)
      )
      .where(eq(sqliteOpenDropSchema.deploymentFamilies.ownerUserId, userId))
      .orderBy(desc(sqliteOpenDropSchema.deploymentFamilies.updatedAt));
    return rows.map((row) => ({
      family: mapDeploymentFamily(row.family),
      version: mapDeploymentVersion(row.version)
    }));
  }

  async createUploadSession(input: CreateUploadSessionInput): Promise<UploadSessionRecord> {
    const now = nowIso();
    await this.orm.insert(sqliteOpenDropSchema.uploadSessions).values({
      id: input.id,
      ownerUserId: input.ownerUserId,
      namespaceName: input.namespace,
      slug: input.slug,
      visibility: input.visibility,
      versionId: input.versionId,
      manifestHash: input.manifestHash,
      manifestJson: JSON.stringify(input.manifest),
      status: "pending",
      resultJson: null,
      failureReason: null,
      expiresAt: input.expiresAt,
      createdAt: now,
      updatedAt: now
    });
    const record = await this.getUploadSessionForOwner(input.id, input.ownerUserId);
    if (!record) throw new Error("Upload session could not be created.");
    return record;
  }

  async getUploadSessionForOwner(sessionId: string, ownerUserId: string): Promise<UploadSessionRecord | null> {
    const row = await this.orm
      .select()
      .from(sqliteOpenDropSchema.uploadSessions)
      .where(and(eq(sqliteOpenDropSchema.uploadSessions.id, sessionId), eq(sqliteOpenDropSchema.uploadSessions.ownerUserId, ownerUserId)))
      .get();
    return row ? mapUploadSession(row) : null;
  }

  async claimUploadSessionForFinalization(
    sessionId: string,
    ownerUserId: string,
    finalizationExpiresAt: string
  ): Promise<FinalizeUploadSessionClaim | null> {
    const result = await this.db
      .prepare("update upload_sessions set status = ?, expires_at = ?, updated_at = ? where id = ? and owner_user_id = ? and status = ?")
      .bind("finalizing", finalizationExpiresAt, nowIso(), sessionId, ownerUserId, "pending")
      .run();
    const session = await this.getUploadSessionForOwner(sessionId, ownerUserId);
    return session ? uploadSessionClaimResult(session, Number(result.meta?.changes ?? 0) > 0) : null;
  }

  async transitionUploadSession(input: TransitionUploadSessionInput): Promise<UploadSessionRecord> {
    if (input.expectedStatuses.length === 0) throw new Error("Expected upload session statuses are required.");
    await this.orm
      .update(sqliteOpenDropSchema.uploadSessions)
      .set({
        status: input.status,
        resultJson: input.completedResult ? JSON.stringify(input.completedResult) : null,
        failureReason: input.failureReason ?? null,
        updatedAt: nowIso()
      })
      .where(and(
        eq(sqliteOpenDropSchema.uploadSessions.id, input.sessionId),
        eq(sqliteOpenDropSchema.uploadSessions.ownerUserId, input.ownerUserId),
        inArray(sqliteOpenDropSchema.uploadSessions.status, input.expectedStatuses)
      ));
    const record = await this.getUploadSessionForOwner(input.sessionId, input.ownerUserId);
    if (!record) throw new Error("Upload session not found.");
    return record;
  }

  async createDeploymentVersion(input: CreateVersionInput): Promise<DeploymentWithVersion> {
    return this.orm.transaction(async (tx) => {
      const namespace = await tx.select().from(sqliteOpenDropSchema.namespaces).where(eq(sqliteOpenDropSchema.namespaces.name, input.namespace)).get();
      if (!namespace) throw new Error("Namespace not found.");
      const ownedNamespace = await tx
        .select({ id: sqliteOpenDropSchema.namespaces.id })
        .from(sqliteOpenDropSchema.namespaces)
        .where(and(eq(sqliteOpenDropSchema.namespaces.name, input.namespace), eq(sqliteOpenDropSchema.namespaces.ownerUserId, input.ownerUserId)))
        .get();
      const publisherNamespace = ownedNamespace
        ? ownedNamespace
        : await tx
            .select({ id: sqliteOpenDropSchema.namespaceMembers.namespaceId })
            .from(sqliteOpenDropSchema.namespaceMembers)
            .innerJoin(sqliteOpenDropSchema.namespaces, eq(sqliteOpenDropSchema.namespaceMembers.namespaceId, sqliteOpenDropSchema.namespaces.id))
            .where(
              and(
                eq(sqliteOpenDropSchema.namespaces.name, input.namespace),
                eq(sqliteOpenDropSchema.namespaceMembers.userId, input.ownerUserId),
                inArray(sqliteOpenDropSchema.namespaceMembers.role, ["owner", "publisher"])
              )
            )
            .get();
      if (!publisherNamespace) {
        throw new Error("User cannot publish to this namespace.");
      }

      const now = nowIso();
      let family = await tx
        .select()
        .from(sqliteOpenDropSchema.deploymentFamilies)
        .where(and(eq(sqliteOpenDropSchema.deploymentFamilies.namespaceName, input.namespace), eq(sqliteOpenDropSchema.deploymentFamilies.slug, input.slug)))
        .get();
      if (!family) {
        const familyId = randomId("dep_");
        await tx.insert(sqliteOpenDropSchema.deploymentFamilies).values({
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
        family = await tx.select().from(sqliteOpenDropSchema.deploymentFamilies).where(eq(sqliteOpenDropSchema.deploymentFamilies.id, familyId)).get();
      }
      if (!family) throw new Error("Deployment family could not be created.");
      if (family.ownerUserId !== input.ownerUserId) {
        throw new Error("Only the slug owner can create a new version.");
      }

      const latestVersion = await tx
        .select({ versionNumber: sqliteOpenDropSchema.deploymentVersions.versionNumber })
        .from(sqliteOpenDropSchema.deploymentVersions)
        .where(eq(sqliteOpenDropSchema.deploymentVersions.familyId, family.id))
        .orderBy(desc(sqliteOpenDropSchema.deploymentVersions.versionNumber))
        .limit(1)
        .get();
      const versionId = input.versionId ?? randomId("ver_");
      await tx.insert(sqliteOpenDropSchema.deploymentVersions).values({
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
        await tx.insert(sqliteOpenDropSchema.deploymentFiles).values(
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
        .update(sqliteOpenDropSchema.deploymentFamilies)
        .set({ latestVersionId: versionId, visibility: input.visibility, updatedAt: now })
        .where(eq(sqliteOpenDropSchema.deploymentFamilies.id, family.id));
      const nextFamily = await tx.select().from(sqliteOpenDropSchema.deploymentFamilies).where(eq(sqliteOpenDropSchema.deploymentFamilies.id, family.id)).get();
      const version = await tx.select().from(sqliteOpenDropSchema.deploymentVersions).where(eq(sqliteOpenDropSchema.deploymentVersions.id, versionId)).get();
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
      .update(sqliteOpenDropSchema.deploymentFamilies)
      .set({ visibility, updatedAt: nowIso() })
      .where(eq(sqliteOpenDropSchema.deploymentFamilies.id, family.id));
    const row = await this.orm.select().from(sqliteOpenDropSchema.deploymentFamilies).where(eq(sqliteOpenDropSchema.deploymentFamilies.id, family.id)).get();
    if (!row) throw new Error("Deployment not found.");
    return mapDeploymentFamily(row);
  }

  async restoreDeploymentVersion(namespace: string, slug: string, versionId: string, userId: string): Promise<DeploymentWithVersion> {
    const family = await this.getDeploymentFamily(namespace, slug);
    if (!family) throw new Error("Deployment not found.");
    if (family.ownerUserId !== userId) throw new Error("Only the owner can restore a version.");
    const versionRow = await this.orm
      .select()
      .from(sqliteOpenDropSchema.deploymentVersions)
      .where(and(eq(sqliteOpenDropSchema.deploymentVersions.id, versionId), eq(sqliteOpenDropSchema.deploymentVersions.familyId, family.id)))
      .get();
    if (!versionRow) throw new Error("Version not found.");
    await this.orm
      .update(sqliteOpenDropSchema.deploymentFamilies)
      .set({ latestVersionId: versionId, updatedAt: nowIso() })
      .where(eq(sqliteOpenDropSchema.deploymentFamilies.id, family.id));
    const familyRow = await this.orm.select().from(sqliteOpenDropSchema.deploymentFamilies).where(eq(sqliteOpenDropSchema.deploymentFamilies.id, family.id)).get();
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
    const versionRow = await this.orm
      .select()
      .from(sqliteOpenDropSchema.deploymentVersions)
      .where(and(eq(sqliteOpenDropSchema.deploymentVersions.id, selectedVersionId), eq(sqliteOpenDropSchema.deploymentVersions.familyId, family.id)))
      .get();
    if (!versionRow) return null;
    return { family, version: mapDeploymentVersion(versionRow) };
  }

  async listDeploymentVersions(namespace: string, slug: string): Promise<DeploymentVersionRecord[]> {
    const family = await this.getDeploymentFamily(namespace, slug);
    if (!family) return [];
    const rows = await this.orm
      .select()
      .from(sqliteOpenDropSchema.deploymentVersions)
      .where(eq(sqliteOpenDropSchema.deploymentVersions.familyId, family.id))
      .orderBy(desc(sqliteOpenDropSchema.deploymentVersions.versionNumber));
    return rows.map(mapDeploymentVersion);
  }

  async listDeploymentFiles(versionId: string): Promise<DeploymentFileRecord[]> {
    const rows = await this.orm
      .select()
      .from(sqliteOpenDropSchema.deploymentFiles)
      .where(eq(sqliteOpenDropSchema.deploymentFiles.versionId, versionId))
      .orderBy(asc(sqliteOpenDropSchema.deploymentFiles.path));
    return rows.map(mapDeploymentFile);
  }

  async getDeploymentFile(versionId: string, path: string): Promise<DeploymentFileRecord | null> {
    const row = await this.orm
      .select()
      .from(sqliteOpenDropSchema.deploymentFiles)
      .where(and(eq(sqliteOpenDropSchema.deploymentFiles.versionId, versionId), eq(sqliteOpenDropSchema.deploymentFiles.path, path)))
      .get();
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
    await this.orm.insert(sqliteOpenDropSchema.annotations).values(annotationInsertValues(deployment, input, userId, id, now));
    const row = await this.orm.select().from(sqliteOpenDropSchema.annotations).where(eq(sqliteOpenDropSchema.annotations.id, id)).get();
    if (!row) throw new Error("Annotation not found.");
    return mapDbAnnotation(row);
  }

  async setAnnotationResolved(namespace: string, slug: string, annotationId: string, resolved: boolean, _userId: string): Promise<AnnotationRecord> {
    const family = await this.getDeploymentFamily(namespace, slug);
    if (!family) throw new Error("Deployment not found.");
    const now = nowIso();
    await this.orm
      .update(sqliteOpenDropSchema.annotations)
      .set({ resolvedAt: resolved ? now : null, updatedAt: now })
      .where(and(eq(sqliteOpenDropSchema.annotations.id, annotationId), eq(sqliteOpenDropSchema.annotations.familyId, family.id)));
    const row = await this.orm
      .select()
      .from(sqliteOpenDropSchema.annotations)
      .where(and(eq(sqliteOpenDropSchema.annotations.id, annotationId), eq(sqliteOpenDropSchema.annotations.familyId, family.id)))
      .get();
    if (!row) throw new Error("Annotation not found.");
    return mapDbAnnotation(row);
  }

  async listAnnotations(namespace: string, slug: string, versionId: string, pagePath?: string): Promise<AnnotationRecord[]> {
    const family = await this.getDeploymentFamily(namespace, slug);
    if (!family) return [];
    const where = pagePath
      ? and(
          eq(sqliteOpenDropSchema.annotations.familyId, family.id),
          eq(sqliteOpenDropSchema.annotations.versionId, versionId),
          eq(sqliteOpenDropSchema.annotations.pagePath, pagePath)
        )
      : and(eq(sqliteOpenDropSchema.annotations.familyId, family.id), eq(sqliteOpenDropSchema.annotations.versionId, versionId));
    const rows = await this.orm
      .select()
      .from(sqliteOpenDropSchema.annotations)
      .where(where)
      .orderBy(asc(sqliteOpenDropSchema.annotations.createdAt));
    return rows.map(mapDbAnnotation);
  }

  private async allocateNamespace(email: string): Promise<string> {
    return allocateNamespaceForEmail(email, async (candidate) =>
      Boolean(
        await this.orm
          .select({ id: sqliteOpenDropSchema.namespaces.id })
          .from(sqliteOpenDropSchema.namespaces)
          .where(eq(sqliteOpenDropSchema.namespaces.name, candidate))
          .get()
      )
    );
  }

  private async getOwnedNamespace(name: string, ownerUserId: string): Promise<NamespaceRecord> {
    const namespace = await this.getNamespace(name);
    if (!namespace) throw new Error("Namespace not found.");
    if (namespace.ownerUserId !== ownerUserId) throw new Error("Only the namespace owner can manage publishers.");
    return namespace;
  }

  private async assertParentAnnotation(familyId: string, versionId: string, pagePath: string, parentAnnotationId: string): Promise<void> {
    const parent = await this.orm
      .select({ id: sqliteOpenDropSchema.annotations.id })
      .from(sqliteOpenDropSchema.annotations)
      .where(
        and(
          eq(sqliteOpenDropSchema.annotations.id, parentAnnotationId),
          eq(sqliteOpenDropSchema.annotations.familyId, familyId),
          eq(sqliteOpenDropSchema.annotations.versionId, versionId),
          eq(sqliteOpenDropSchema.annotations.pagePath, pagePath)
        )
      )
      .get();
    if (!parent) throw new Error("Parent annotation not found for this page version.");
  }

}

export function createD1Repository(db: D1DatabaseLike): OpenDropRepository {
  return new D1OpenDropRepository(db);
}
