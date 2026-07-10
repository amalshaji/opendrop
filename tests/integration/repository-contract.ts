import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { OpenDropRepository } from "../../packages/shared/src/db/repository";
import { createRawCliToken, hashToken } from "../../packages/shared/src/db/tokens";

export async function expectOpenDropRepositoryContract(repo: OpenDropRepository): Promise<void> {
  await repo.migrate();
  await repo.migrate();

  const suffix = randomUUID().slice(0, 8);
  const user = await repo.getOrCreateUser({
    provider: "dev",
    subject: `owner-${suffix}@example.com`,
    email: `owner-${suffix}@example.com`,
    name: "Contract Owner"
  });
  assert.match(user.defaultNamespace, /^owner-[a-f0-9-]+/);
  assert.equal(await repo.userCanPublishNamespace(user.id, user.defaultNamespace), true);
  assert.equal((await repo.getUserByIdentity("dev", `owner-${suffix}@example.com`))?.id, user.id);

  const linkedEmail = `linked-${suffix}@example.com`;
  const existingEmailUser = await repo.getOrCreateUser({
    provider: "oauth",
    subject: `oauth-${suffix}`,
    email: linkedEmail,
    name: "Existing OAuth User"
  });
  const secondOAuthIdentity = await repo.getOrCreateUser({
    provider: "oauth",
    subject: `oauth-second-${suffix}`,
    email: linkedEmail,
    name: "Existing OAuth User Refreshed"
  });
  assert.equal(secondOAuthIdentity.id, existingEmailUser.id);
  assert.equal((await repo.getUserByIdentity("oauth", `oauth-second-${suffix}`))?.id, existingEmailUser.id);
  await assert.rejects(
    () =>
      repo.getOrCreateUser({
        provider: "trusted-header",
        subject: `trusted-${suffix}`,
        email: linkedEmail,
        name: "Trusted Header User"
      }),
    /different trusted-header subject/
  );
  const linkedUser = await repo.linkIdentityToEmail({
    provider: "trusted-header",
    subject: `trusted-${suffix}`,
    email: linkedEmail,
    name: "Trusted Header User"
  });
  assert.equal(linkedUser?.id, existingEmailUser.id);
  assert.equal((await repo.getUserByIdentity("trusted-header", `trusted-${suffix}`))?.id, existingEmailUser.id);

  const sharedNamespaceName = `shared-${suffix}`;
  const sharedNamespace = await repo.createNamespace(sharedNamespaceName, user.id);
  assert.equal(sharedNamespace.role, "owner");
  assert.equal(sharedNamespace.name, sharedNamespaceName);
  assert.ok((await repo.listNamespacesForUser(user.id)).some((item) => item.name === sharedNamespaceName && item.role === "owner"));
  assert.equal((await repo.listNamespaceMembers(sharedNamespaceName, user.id)).length, 1);
  await assert.rejects(() => repo.createNamespace("api", user.id), /reserved/i);
  const publisher = await repo.addNamespacePublisher(sharedNamespaceName, user.id, linkedEmail);
  assert.equal(publisher.email, linkedEmail);
  assert.equal(publisher.role, "publisher");
  assert.ok((await repo.listNamespaceMembers(sharedNamespaceName, user.id)).some((item) => item.email === linkedEmail && item.role === "publisher"));
  assert.ok((await repo.listNamespacesForUser(existingEmailUser.id)).some((item) => item.name === sharedNamespaceName && item.role === "publisher"));
  assert.equal(await repo.userCanPublishNamespace(existingEmailUser.id, sharedNamespaceName), true);

  const publisherOwned = await repo.createDeploymentVersion({
    namespace: sharedNamespaceName,
    slug: `publisher-owned-${suffix}`,
    ownerUserId: existingEmailUser.id,
    visibility: "public",
    manifestHash: `shared-manifest-${suffix}-1`,
    files: [
      {
        path: "index.html",
        size: 11,
        sha256: sha("publisher-owned"),
        contentType: "text/html",
        lineCount: 1,
        storageKey: `artifacts/${suffix}/shared/v1/index.html`
      }
    ]
  });
  await assert.rejects(
    () =>
      repo.createDeploymentVersion({
        namespace: sharedNamespaceName,
        slug: `publisher-owned-${suffix}`,
        ownerUserId: user.id,
        visibility: "public",
        manifestHash: `shared-manifest-${suffix}-2`,
        files: [
          {
            path: "index.html",
            size: 12,
            sha256: sha("owner-tries-version"),
            contentType: "text/html",
            lineCount: 1,
            storageKey: `artifacts/${suffix}/shared/v2/index.html`
          }
        ]
      }),
    /slug owner/
  );
  const publisherSecond = await repo.createDeploymentVersion({
    namespace: sharedNamespaceName,
    slug: `publisher-owned-${suffix}`,
    ownerUserId: existingEmailUser.id,
    visibility: "public",
    manifestHash: `shared-manifest-${suffix}-3`,
    files: [
      {
        path: "index.html",
        size: 13,
        sha256: sha("publisher-second"),
        contentType: "text/html",
        lineCount: 1,
        storageKey: `artifacts/${suffix}/shared/v3/index.html`
      }
    ]
  });
  assert.equal(publisherOwned.version.versionNumber, 1);
  assert.equal(publisherSecond.version.versionNumber, 2);
  const publishedByPublisher = await repo.listDeploymentsForUser(existingEmailUser.id);
  assert.equal(publishedByPublisher.length, 1);
  assert.equal(publishedByPublisher[0]?.family.slug, `publisher-owned-${suffix}`);
  assert.equal(publishedByPublisher[0]?.version.id, publisherSecond.version.id);
  assert.equal((await repo.listDeploymentsForUser(user.id)).length, 0);
  await repo.removeNamespacePublisher(sharedNamespaceName, user.id, existingEmailUser.id);
  assert.equal(await repo.userCanPublishNamespace(existingEmailUser.id, sharedNamespaceName), false);

  const tokenHash = `hash-${suffix}`;
  await repo.createCliToken(user.id, tokenHash, "contract", "vitest");
  assert.equal((await repo.getUserByCliTokenHash(tokenHash))?.id, user.id);
  const [connection] = await repo.listCliTokens(user.id);
  assert.equal(connection.label, "contract");
  assert.ok(connection.lastUsedAt);
  assert.equal(Object.prototype.hasOwnProperty.call(connection, "tokenHash"), false);
  await repo.revokeCliToken(user.id, connection.id);
  assert.equal(await repo.getUserByCliTokenHash(tokenHash), null);

  const deviceCodeHash = `device-code-hash-${suffix}`;
  const deviceUserCode = `USER-${suffix.toUpperCase()}`;
  const device = await repo.createDeviceAuthorization({
    deviceCodeHash,
    userCode: deviceUserCode,
    label: "contract-device",
    deviceName: "repository-contract",
    userAgent: "contract-agent",
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  });
  assert.equal(device.userCode, deviceUserCode);
  assert.equal((await repo.getDeviceAuthorizationByUserCode(deviceUserCode))?.status, "pending");

  await repo.approveDeviceAuthorization(deviceUserCode, user.id);
  assert.equal((await repo.getDeviceAuthorizationByUserCode(deviceUserCode))?.status, "approved");
  const candidateTokens = [createRawCliToken(), createRawCliToken()];
  const exchangeResults = await Promise.all(
    candidateTokens.map(async (token) => ({ token, result: await repo.exchangeDeviceAuthorization(deviceCodeHash, await hashToken(token)) }))
  );
  const issuedTokens = exchangeResults.filter(({ result }) => result?.status === "issued").map(({ token }) => token);
  assert.equal(issuedTokens.length, 1);
  assert.equal((await repo.getUserByCliTokenHash(await hashToken(issuedTokens[0]!)))?.id, user.id);
  assert.ok((await repo.listCliTokens(user.id)).some((item) => item.label === "contract-device" && item.deviceName === "repository-contract"));
  const exchangedAgainToken = createRawCliToken();
  const exchangedAgain = await repo.exchangeDeviceAuthorization(deviceCodeHash, await hashToken(exchangedAgainToken));
  assert.equal(exchangedAgain?.status, "already_exchanged");

  const rejectedDeviceHash = `rejected-device-code-hash-${suffix}`;
  const rejectedUserCode = `NOPE-${suffix.toUpperCase()}`;
  await repo.createDeviceAuthorization({
    deviceCodeHash: rejectedDeviceHash,
    userCode: rejectedUserCode,
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  });
  await repo.rejectDeviceAuthorization(rejectedUserCode, user.id);
  assert.equal((await repo.getDeviceAuthorizationByUserCode(rejectedUserCode))?.status, "rejected");
  assert.equal((await repo.exchangeDeviceAuthorization(rejectedDeviceHash, await hashToken(createRawCliToken())))?.status, "rejected");

  const slug = `contract-${suffix}`;
  const first = await repo.createDeploymentVersion({
    namespace: user.defaultNamespace,
    slug,
    ownerUserId: user.id,
    visibility: "public",
    manifestHash: `manifest-${suffix}-1`,
    files: [
      {
        path: "index.html",
        size: 12,
        sha256: sha("hello world"),
        contentType: "text/html",
        lineCount: 1,
        storageKey: `artifacts/${suffix}/v1/index.html`
      }
    ]
  });
  assert.equal(first.version.versionNumber, 1);
  assert.equal(first.family.latestVersionId, first.version.id);

  const uploadSession = await repo.createUploadSession({
    id: `upl_${suffix}`,
    ownerUserId: user.id,
    namespace: user.defaultNamespace,
    slug: `session-${suffix}`,
    visibility: "public",
    versionId: `ver_session_${suffix}`,
    manifestHash: `session-manifest-${suffix}`,
    manifest: [
      {
        path: "index.html",
        size: 12,
        sha256: sha("hello world"),
        contentType: "text/html; charset=utf-8",
        lineCount: 1
      }
    ],
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  });
  assert.equal(uploadSession.status, "pending");
  assert.equal(uploadSession.manifest[0]?.path, "index.html");
  assert.equal(await repo.getUploadSessionForOwner(uploadSession.id, existingEmailUser.id), null);
  const completedSession = await repo.transitionUploadSession({
    sessionId: uploadSession.id,
    ownerUserId: user.id,
    expectedStatuses: ["pending"],
    status: "completed",
    completedResult: first
  });
  assert.equal(completedSession.status, "completed");
  assert.equal(completedSession.completedResult?.version.id, first.version.id);
  const repeatedCompletion = await repo.transitionUploadSession({
    sessionId: uploadSession.id,
    ownerUserId: user.id,
    expectedStatuses: ["pending"],
    status: "failed",
    failureReason: "must not replace completion"
  });
  assert.equal(repeatedCompletion.status, "completed");
  assert.equal(repeatedCompletion.failureReason, null);

  const second = await repo.createDeploymentVersion({
    namespace: user.defaultNamespace,
    slug,
    ownerUserId: user.id,
    visibility: "private",
    manifestHash: `manifest-${suffix}-2`,
    files: [
      {
        path: "index.html",
        size: 13,
        sha256: sha("hello again"),
        contentType: "text/html",
        lineCount: 1,
        storageKey: `artifacts/${suffix}/v2/index.html`
      },
      {
        path: "assets/app.css",
        size: 6,
        sha256: sha("css"),
        contentType: "text/css",
        storageKey: `artifacts/${suffix}/v2/assets/app.css`
      }
    ]
  });

  assert.equal(second.version.versionNumber, 2);
  const publishedByOwner = await repo.listDeploymentsForUser(user.id);
  assert.equal(publishedByOwner.length, 1);
  assert.equal(publishedByOwner[0]?.family.slug, slug);
  assert.equal(publishedByOwner[0]?.version.id, second.version.id);
  assert.equal((await repo.getDeploymentVersion(user.defaultNamespace, slug))?.version.id, second.version.id);
  assert.equal((await repo.getDeploymentVersion(user.defaultNamespace, slug, first.version.id))?.version.id, first.version.id);
  assert.deepEqual(
    (await repo.listDeploymentVersions(user.defaultNamespace, slug)).map((version) => version.versionNumber),
    [2, 1]
  );
  assert.equal((await repo.getDeploymentFile(second.version.id, "assets/app.css"))?.contentType, "text/css");

  const restored = await repo.restoreDeploymentVersion(user.defaultNamespace, slug, first.version.id, user.id);
  assert.equal(restored.family.latestVersionId, first.version.id);
  assert.equal((await repo.listDeploymentsForUser(user.id))[0]?.version.id, first.version.id);
  assert.equal((await repo.getDeploymentVersion(user.defaultNamespace, slug))?.version.id, first.version.id);
  assert.equal((await repo.setDeploymentVisibility(user.defaultNamespace, slug, "public", user.id)).visibility, "public");

  const annotation = await repo.createAnnotation(
    user.defaultNamespace,
    slug,
    {
      versionId: second.version.id,
      pagePath: "/",
      body: "Looks good",
      tags: ["review"],
      shape: { type: "pin", x: 0.5, y: 0.5 },
      viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 }
    },
    user.id
  );
  assert.equal(annotation.parentAnnotationId, null);
  assert.deepEqual(annotation.tags, ["review"]);

  const reply = await repo.createAnnotation(
    user.defaultNamespace,
    slug,
    {
      versionId: second.version.id,
      parentAnnotationId: annotation.id,
      pagePath: "/",
      body: "Replying here",
      tags: ["reply"],
      shape: annotation.shape,
      viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 }
    },
    user.id
  );
  assert.equal(reply.parentAnnotationId, annotation.id);

  const resolved = await repo.setAnnotationResolved(user.defaultNamespace, slug, annotation.id, true, user.id);
  assert.ok(resolved.resolvedAt);
  const reopened = await repo.setAnnotationResolved(user.defaultNamespace, slug, annotation.id, false, user.id);
  assert.equal(reopened.resolvedAt, null);
  assert.equal((await repo.listAnnotations(user.defaultNamespace, slug, second.version.id, "/")).length, 2);
}

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
