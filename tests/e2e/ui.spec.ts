import { expect, type Page, test } from "@playwright/test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { strToU8, zipSync } from "fflate";

const serverUrl = process.env.OPENDROP_E2E_SERVER_URL || "http://127.0.0.1:43300";
const validSite = resolve("tests/e2e/fixtures/valid-site");
const responsiveSite = resolve("tests/simple-site");
const cliArgs = (...args: string[]) => ["run", "--cwd", "apps/cli", "dev", "--", ...args];

function uniqueName(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 10_000)}`;
}

async function loginWithDevAuth(page: Page, email: string) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Ship a static preview/i })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: /Continue with Dev Auth/i }).click();
  await expect(page.getByRole("heading", { name: "Publish a static drop" })).toBeVisible();
}

async function openPublishedPreview(page: Page, slug?: string) {
  await expect(page.getByRole("heading", { name: "Publish a static drop" })).toBeVisible();
  const banner = page.locator(".publishSuccessBanner");
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await expect(banner).toContainText("Your site is live");
  await expect(banner.getByRole("button", { name: "Copy URL" })).toBeVisible();
  const link = banner.locator("a").first();
  await expect(link).toHaveAttribute("target", "_blank");
  const href = await link.getAttribute("href");
  if (slug) expect(href).toContain(slug);
  const popupPromise = page.waitForEvent("popup");
  await link.click();
  const popup = await popupPromise;
  await popup.close();
  await page.goto(href!);
}

async function uploadFolder(page: Page, slug: string, options: { visibility?: "public" | "private"; fixture?: string; expectedFile?: string } = {}) {
  await page.locator("input[type=file]").first().setInputFiles(options.fixture || validSite);
  await page.getByPlaceholder("slug optional").fill(slug);
  if (options.visibility === "private") {
    await page.getByRole("button", { name: "Private" }).click();
  }
  await expect(page.getByText("Root index.html found.")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("File tree")).toBeVisible();
  await expect(page.getByText(options.expectedFile || "assets/app.css", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish" })).toBeEnabled();
  await page.getByRole("button", { name: "Publish" }).click();
  await openPublishedPreview(page, slug);
}

async function createZipFixture(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `opendrop-${name}-`));
  const zipPath = join(dir, "site.zip");
  const bytes = zipSync({
    "index.html": strToU8("<h1>Zip fixture published</h1>"),
    "assets/app.css": strToU8("h1 { color: rebeccapurple; }")
  });
  await writeFile(zipPath, Buffer.from(bytes));
  return zipPath;
}

async function dropFiles(page: Page, files: Array<{ name: string; type: string; body: string }>) {
  const dataTransfer = await page.evaluateHandle((items) => {
    const transfer = new DataTransfer();
    for (const item of items) {
      transfer.items.add(new File([item.body], item.name, { type: item.type }));
    }
    return transfer;
  }, files);
  await page.locator(".uploadDropzone").dispatchEvent("dragenter", { dataTransfer });
  await expect(page.locator(".uploadDropzone")).toHaveAttribute("data-dragging", "true");
  await page.locator(".uploadDropzone").dispatchEvent("drop", { dataTransfer });
  await dataTransfer.dispose();
}

async function expectPreview(page: Page, namespace: string, slug: string) {
  await expect.poll(() => normalizedPath(page)).toBe(`/${namespace}/${slug}`);
  await expect(page.frameLocator('iframe[title="OpenDrop preview"]').getByText("Fixture published")).toBeVisible();
}

async function deploymentVersions(page: Page, namespace: string, slug: string) {
  const response = await page.request.get(`${serverUrl}/api/deployments/${namespace}/${slug}/versions`);
  expect(response.ok()).toBe(true);
  return response.json() as Promise<{ latestVersionId: string; versions: Array<{ id: string; versionNumber: number }> }>;
}

async function expectAnnotationBody(page: Page, namespace: string, slug: string, versionId: string, body: string) {
  await expect.poll(async () => {
    const params = new URLSearchParams({ path: "/", versionId });
    const response = await page.request.get(`${serverUrl}/api/deployments/${namespace}/${slug}/annotations?${params}`);
    if (!response.ok()) return false;
    const payload = await response.json();
    return Array.isArray(payload.annotations) && payload.annotations.some((item: { body?: string }) => item.body === body);
  }).toBe(true);
}

async function selectPreviewVersion(page: Page, versionNumber: number) {
  await page.getByLabel("Preview version").click();
  await page.getByRole("option", { name: new RegExp(`v${versionNumber}\\b`) }).click();
}

function threadItemForBody(page: Page, body: string) {
  return page.locator(".threadCard", { hasText: body }).locator(".threadItem");
}

function normalizedPath(page: Page): string {
  return new URL(page.url()).pathname.replace(/\/$/, "");
}

async function waitForMatch<T>(read: () => T | undefined): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    const value = read();
    if (value) return value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("Timed out waiting for CLI output.");
}

async function waitForExit(child: ChildProcessWithoutNullStreams): Promise<number | null> {
  if (child.exitCode !== null) return child.exitCode;
  return new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", resolveExit);
  });
}

test("publish controls stay inside the upload card after validation", async ({ page }) => {
  const namespace = uniqueName("layoutowner");
  await page.setViewportSize({ width: 1502, height: 817 });
  await loginWithDevAuth(page, `${namespace}@example.com`);
  await page.locator("input[type=file]").first().setInputFiles(validSite);
  await expect(page.getByText("Root index.html found.")).toBeVisible({ timeout: 15_000 });

  const uploadPanel = page.locator(".uploadPanel");
  const publishDock = page.locator(".publishDock");
  const publishButton = page.getByRole("button", { name: "Publish", exact: true });
  await expect(publishDock).toBeVisible();
  await expect(publishButton).toBeVisible();
  await expect(publishButton).toBeEnabled();

  const panelBounds = await uploadPanel.boundingBox();
  const dockBounds = await publishDock.boundingBox();
  expect(panelBounds).not.toBeNull();
  expect(dockBounds).not.toBeNull();
  expect(dockBounds!.y + dockBounds!.height).toBeLessThanOrEqual(panelBounds!.y + panelBounds!.height + 1);
});

test("UI auth, upload, view, comment, reply, versions, and visibility", async ({ browser, page }) => {
  const namespace = uniqueName("uiowner");
  const email = `${namespace}@example.com`;
  const slug = uniqueName("playwright");
  const preflight = await page.request.get(`${serverUrl}/__dev/preflight`);
  expect(preflight.ok()).toBe(true);

  await loginWithDevAuth(page, email);
  await uploadFolder(page, slug);
  await expectPreview(page, namespace, slug);

  const firstVersionInfo = await deploymentVersions(page, namespace, slug);
  const versionId = firstVersionInfo.latestVersionId;
  const versionNumber = firstVersionInfo.versions.find((version) => version.id === versionId)?.versionNumber ?? 1;

  await page.locator(".roomToolbar").getByRole("button", { name: "Comment" }).click();
  await page.locator('iframe[title="OpenDrop preview"]').click({ position: { x: 120, y: 80 } });
  await expect(page.getByText("Commenting on a point")).toBeVisible();
  await page.getByPlaceholder("Add a comment").fill("Tighten the headline spacing");
  await page.getByPlaceholder("Add a comment").press("Meta+Enter");
  await expect(threadItemForBody(page, "Tighten the headline spacing")).toBeVisible();
  await expect(page.locator(".commentThread").getByText("Tighten the headline spacing")).toBeVisible();

  await page.locator(".commentThread").getByRole("button", { name: "Reply" }).first().click();
  await page.getByPlaceholder("Write a reply").fill("Captured for the next pass");
  await page.getByPlaceholder("Write a reply").press("Meta+Enter");
  await expect(page.locator(".commentThread").getByText("Captured for the next pass")).toBeVisible();

  await page.locator(".commentNode.isReply", { hasText: "Captured for the next pass" }).getByRole("button", { name: "Reply" }).click();
  await page.getByPlaceholder("Write a reply").fill("Second reply stays on the parent thread");
  await page.getByLabel("Send reply").click();
  await expect(page.locator(".threadItem", { hasText: "2 replies" })).toBeVisible();
  await expect(page.locator(".commentThread > .commentNode > .commentChildren > .commentNode.isReply")).toHaveCount(2);
  await expect(page.locator(".commentThread > .commentNode > .commentChildren > .commentNode.isReply .commentChildren .commentNode.isReply")).toHaveCount(0);

  const reviewerEmail = `${namespace}-reviewer@example.com`;
  const reviewerContext = await browser.newContext();
  const reviewerPage = await reviewerContext.newPage();
  const reviewerReturnTo = encodeURIComponent(`/${namespace}/${slug}?version=${versionId}`);
  await reviewerPage.goto(`${serverUrl}/__dev/log-me-in/${reviewerEmail}?returnTo=${reviewerReturnTo}`);
  await expectPreview(reviewerPage, namespace, slug);
  await reviewerPage.locator(".roomToolbar").getByRole("button", { name: "Comment" }).click();
  await reviewerPage.locator('iframe[title="OpenDrop preview"]').click({ position: { x: 160, y: 100 } });
  await reviewerPage.getByPlaceholder("Add a comment").fill("Reviewer identity should show");
  await reviewerPage.getByLabel("Submit comment").click();
  await expect(threadItemForBody(reviewerPage, "Reviewer identity should show")).toBeVisible();
  await expectAnnotationBody(page, namespace, slug, versionId, "Reviewer identity should show");
  await reviewerContext.close();

  await page.goto(`${serverUrl}/${namespace}/${slug}?version=${versionId}`);
  const reviewerThread = page.locator(".threadItem", { hasText: reviewerEmail });
  await expect(reviewerThread).toBeVisible({ timeout: 15_000 });
  await expect(reviewerThread).toContainText(reviewerEmail);

  const ownerThread = page.locator(".threadItem", { hasText: "2 replies" });
  await ownerThread.click();
  await expect(page.locator(".commentThread")).toBeVisible();
  await expect(page.locator(".commentThread").getByText("Tighten the headline spacing")).toBeVisible();
  await page.locator(".commentThread").getByRole("button", { name: "Resolve" }).click();
  await expect(page.getByText("Resolved")).toBeVisible();

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Publish a static drop" })).toBeVisible();
  await page.locator("input[type=file]").first().setInputFiles(validSite);
  await page.getByPlaceholder("slug optional").fill(slug);
  await expect(page.getByText("Root index.html found.")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Publish" }).click();
  await openPublishedPreview(page, slug);
  await expectPreview(page, namespace, slug);
  const secondVersionInfo = await deploymentVersions(page, namespace, slug);
  expect(secondVersionInfo.versions).toHaveLength(2);
  expect(secondVersionInfo.latestVersionId).not.toBe(versionId);

  await selectPreviewVersion(page, versionNumber);
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByRole("button", { name: "Restore" })).toHaveCount(0);
  const restoredVersions = await deploymentVersions(page, namespace, slug);
  expect(restoredVersions.latestVersionId).toBe(versionId);

  const visibility = page.locator(".roomVisibility");
  const privateButton = visibility.getByRole("button", { name: "Private" });
  const publicButton = visibility.getByRole("button", { name: "Public" });
  await privateButton.click();
  await expect(privateButton).toHaveClass(/isSelected/);
  const anonymousPrivateContext = await browser.newContext();
  const anonymousPrivatePage = await anonymousPrivateContext.newPage();
  const privateResponse = await anonymousPrivatePage.goto(`${serverUrl}/${namespace}/${slug}`);
  expect(privateResponse?.status()).toBe(401);
  await anonymousPrivateContext.close();

  await publicButton.click();
  await expect(publicButton).toHaveClass(/isSelected/);
  const anonymousPublicContext = await browser.newContext();
  const anonymousPublicPage = await anonymousPublicContext.newPage();
  const publicResponse = await anonymousPublicPage.goto(`${serverUrl}/${namespace}/${slug}`);
  expect(publicResponse?.status()).toBe(200);
  await expect(anonymousPublicPage.frameLocator('iframe[title="OpenDrop preview"]').getByText("Fixture published")).toBeVisible();
  await anonymousPublicContext.close();
});

test("published drops lists only the signed-in user's deployments", async ({ browser, page }) => {
  const namespace = uniqueName("publishedowner");
  const slug = uniqueName("published");

  await loginWithDevAuth(page, `${namespace}@example.com`);
  await uploadFolder(page, slug);
  await page.goto("/");
  await page.getByRole("button", { name: "All drops" }).click();

  await expect(page.getByRole("heading", { name: "Published drops" })).toBeVisible();
  const route = `/${namespace}/${slug}`;
  const row = page.locator(".publishedRow").filter({ hasText: route });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Public");
  await expect(row).toContainText("v1");
  await expect(row).toContainText("2 files");
  await expect(row.getByRole("link", { name: `Open ${route}` })).toHaveAttribute("href", route);

  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  await loginWithDevAuth(otherPage, `${uniqueName("publishedother")}@example.com`);
  await otherPage.getByRole("button", { name: "All drops" }).click();
  await expect(otherPage.getByText("No published drops yet")).toBeVisible();
  await expect(otherPage.getByText(route, { exact: true })).toHaveCount(0);
  await otherContext.close();
});

test("private previews require auth and hide owner controls from reviewers", async ({ browser, page }) => {
  const namespace = uniqueName("privateowner");
  const email = `${namespace}@example.com`;
  const slug = uniqueName("private-playwright");

  await loginWithDevAuth(page, email);
  await uploadFolder(page, slug, { visibility: "private" });
  await expectPreview(page, namespace, slug);
  const versionInfo = await deploymentVersions(page, namespace, slug);
  const versionId = versionInfo.latestVersionId;

  const anonymousContext = await browser.newContext();
  const anonymousPage = await anonymousContext.newPage();
  const anonymousResponse = await anonymousPage.goto(`${serverUrl}/${namespace}/${slug}`);
  expect(anonymousResponse?.status()).toBe(401);
  await anonymousContext.close();

  const reviewerContext = await browser.newContext();
  const reviewerPage = await reviewerContext.newPage();
  const returnTo = encodeURIComponent(`/${namespace}/${slug}?version=${versionId}`);
  await reviewerPage.goto(`${serverUrl}/__dev/log-me-in/reviewer-${Date.now()}@example.com?returnTo=${returnTo}`);
  await expect(reviewerPage.frameLocator('iframe[title="OpenDrop preview"]').getByText("Fixture published")).toBeVisible();
  await expect(reviewerPage.getByRole("button", { name: "Restore" })).toHaveCount(0);
  await expect(reviewerPage.locator(".roomVisibility")).toHaveCount(0);
  await reviewerContext.close();
});

test("public preview comment sign-in returns reviewers to the preview", async ({ browser, page }) => {
  const namespace = uniqueName("publicreviewer");
  const email = `${namespace}@example.com`;
  const slug = uniqueName("public-comment-playwright");

  await loginWithDevAuth(page, email);
  await uploadFolder(page, slug);
  await expectPreview(page, namespace, slug);

  const reviewerContext = await browser.newContext();
  const reviewerPage = await reviewerContext.newPage();
  await reviewerPage.goto(`${serverUrl}/${namespace}/${slug}`);
  await expect(reviewerPage.frameLocator('iframe[title="OpenDrop preview"]').getByText("Fixture published")).toBeVisible();

  const previewUrl = new URL(reviewerPage.url());
  const previewReturnTo = `${previewUrl.pathname}${previewUrl.search}`;
  await reviewerPage.locator(".roomToolbar").getByRole("button", { name: "Comment" }).click();
  await reviewerPage.getByRole("button", { name: "Sign in to comment" }).click();
  await expect.poll(() => new URL(reviewerPage.url()).pathname).toBe("/");
  expect(new URL(reviewerPage.url()).searchParams.get("returnTo")).toBe(previewReturnTo);

  await reviewerPage.getByLabel("Email").fill(`reviewer-${Date.now()}@example.com`);
  await reviewerPage.getByRole("button", { name: /Continue with Dev Auth/i }).click();
  await expect.poll(() => new URL(reviewerPage.url()).pathname).toBe(previewUrl.pathname);
  await expect(reviewerPage.frameLocator('iframe[title="OpenDrop preview"]').getByText("Fixture published")).toBeVisible();

  await reviewerPage.getByPlaceholder("Add a comment").fill("Anonymous reviewer came back after sign-in");
  await expect(reviewerPage.getByLabel("Submit comment")).toBeEnabled();
  await reviewerPage.getByLabel("Submit comment").click();
  await expect(threadItemForBody(reviewerPage, "Anonymous reviewer came back after sign-in")).toBeVisible();
  await reviewerContext.close();
});

test("text highlights stay anchored after responsive resize", async ({ page }) => {
  const namespace = uniqueName("anchorowner");
  const email = `${namespace}@example.com`;
  const slug = uniqueName("anchor-playwright");

  await page.setViewportSize({ width: 1280, height: 850 });
  await loginWithDevAuth(page, email);
  await uploadFolder(page, slug, { fixture: responsiveSite, expectedFile: "styles.css" });
  await expect.poll(() => normalizedPath(page)).toBe(`/${namespace}/${slug}`);
  await expect(page.frameLocator('iframe[title="OpenDrop preview"]').getByText("Field-ready gear")).toBeVisible();

  const frame = page.frameLocator('iframe[title="OpenDrop preview"]');
  await frame.locator("body").click({ position: { x: 8, y: 8 } });
  await page.keyboard.press("h");
  await expect.poll(() => frame.locator("body").evaluate(() => document.body.style.cursor)).toBe("text");
  await page.keyboard.press("c");
  await expect.poll(() => frame.locator("body").evaluate(() => document.body.style.cursor)).toBe("crosshair");
  await page.keyboard.press("b");
  await expect.poll(() => frame.locator("body").evaluate(() => document.body.style.cursor)).toBe("");
  await page.keyboard.press("h");
  await expect.poll(() => frame.locator("body").evaluate(() => document.body.style.cursor)).toBe("text");
  await frame.locator("body").evaluate(() => {
    const paragraph = document.querySelector(".hero-copy p:not(.eyebrow)");
    if (!paragraph) throw new Error("Missing hero paragraph");
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    let node: Text | null = null;
    while ((node = walker.nextNode() as Text | null)) {
      const value = node.nodeValue || "";
      const start = value.indexOf("Atlas Supply Co.");
      if (start >= 0) {
        const quote = "Atlas Supply Co. is a fictional operations outfitter";
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + quote.length);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, view: window }));
        return;
      }
    }
    throw new Error("Missing selectable text");
  });
  await expect(page.getByText("“Atlas Supply Co. is a fictional operations outfitter”")).toBeVisible();
  await page.getByPlaceholder("Add a comment").fill("Highlight should follow this paragraph");
  await page.getByLabel("Submit comment").click();
  await expect(threadItemForBody(page, "Highlight should follow this paragraph")).toBeVisible();
  const versionInfo = await deploymentVersions(page, namespace, slug);
  const annotationsResponse = await page.request.get(`${serverUrl}/api/deployments/${namespace}/${slug}/annotations?path=/&versionId=${versionInfo.latestVersionId}`);
  expect(annotationsResponse.ok()).toBe(true);
  const annotationsPayload = await annotationsResponse.json();
  const savedShape = annotationsPayload.annotations.find((item: any) => item.body === "Highlight should follow this paragraph")?.shape;
  expect(savedShape?.anchor?.kind).toBe("text-range");

  await page.setViewportSize({ width: 1780, height: 980 });
  await expect.poll(async () => {
    return frame.locator("body").evaluate(() => {
      const overlay = document.querySelector<HTMLElement>('[data-opendrop-layer] > div');
      const paragraph = document.querySelector(".hero-copy p:not(.eyebrow)");
      if (!overlay) return 900;
      if (!paragraph) return 800;
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      const textRect = range.getClientRects()[0];
      const overlayRect = overlay.getBoundingClientRect();
      if (!textRect) return 700;
      return Math.max(
        Math.abs(overlayRect.left - textRect.left),
        Math.abs(overlayRect.top - textRect.top)
      );
    });
  }, { timeout: 10_000 }).toBeLessThan(4);

  await page.setViewportSize({ width: 900, height: 320 });
  const expectedScrollTop = await frame.locator("body").evaluate(() => {
    const overlay = document.querySelector<HTMLElement>('[data-opendrop-layer] > div');
    if (!overlay) return 0;
    const scroller = document.scrollingElement || document.documentElement;
    const rect = overlay.getBoundingClientRect();
    const targetTop = Math.max(0, rect.top + scroller.scrollTop + rect.height / 2 - window.innerHeight / 2);
    scroller.scrollTop = 0;
    return targetTop;
  });
  expect(expectedScrollTop).toBeGreaterThan(10);
  await threadItemForBody(page, "Highlight should follow this paragraph").dispatchEvent("click");
  await expect.poll(() => frame.locator("body").evaluate(() => {
    const overlay = document.querySelector<HTMLElement>('[data-opendrop-layer] > div');
    if (!overlay) return 999;
    const scroller = document.scrollingElement || document.documentElement;
    const current = scroller.scrollTop;
    const rect = overlay.getBoundingClientRect();
    const targetTop = Math.max(0, rect.top + current + rect.height / 2 - window.innerHeight / 2);
    return Math.abs(current - targetTop);
  }), { timeout: 10_000 }).toBeLessThan(8);
});

test("settings manages custom namespaces, publishers, and connections tab", async ({ page, request }) => {
  const ownerNamespace = uniqueName("settingsowner");
  const namespaceName = uniqueName("team-ui");
  const publisherEmail = `publisher-ui-${Date.now()}@example.com`;
  await request.post(`${serverUrl}/api/dev/login`, {
    data: { email: publisherEmail, name: "Publisher UI User" }
  });

  await loginWithDevAuth(page, `${ownerNamespace}@example.com`);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Namespaces/ })).toHaveAttribute("aria-selected", "true");

  await page.getByPlaceholder("namespace name").fill(namespaceName);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText(`Namespace /${namespaceName} created.`)).toBeVisible();
  const namespaceItem = page.locator(".namespaceItem").filter({ hasText: `/${namespaceName}` });
  await expect(namespaceItem.getByText(`/${namespaceName}`, { exact: true })).toBeVisible();

  await namespaceItem.getByPlaceholder("publisher email").fill(publisherEmail);
  await namespaceItem.getByRole("button", { name: "Add publisher" }).click();
  await expect(page.getByText(`${publisherEmail} can publish to /${namespaceName}.`)).toBeVisible();
  await expect(namespaceItem.getByText(publisherEmail)).toBeVisible();

  await namespaceItem.getByLabel(`Remove ${publisherEmail}`).click();
  await expect(page.getByText(`Publisher access removed from /${namespaceName}.`)).toBeVisible();

  await page.getByRole("tab", { name: /Connections/ }).click();
  await expect(page.getByRole("tab", { name: /Connections/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("No connections yet.")).toBeVisible();
  await expect(page.getByText("dev-browser-session")).toHaveCount(0);
});

test("CLI device login is approved and revoked through the browser UI", async ({ page }) => {
  const email = `device-ui-${Date.now()}@example.com`;
  const home = await mkdtemp(join(tmpdir(), "opendrop-ui-cli-"));
  const child = spawn("bun", cliArgs("login", "--server", serverUrl, "--no-open"), { env: { ...process.env, HOME: home } });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    const approvalUrl = await waitForMatch(() => stdout.match(/Open this URL to approve login:\s*\n(\S+)/)?.[1]);
    const userCode = await waitForMatch(() => stdout.match(/Code:\s*([A-Z0-9-]+)/)?.[1]);
    await page.goto(approvalUrl);
    await expect(page.getByRole("heading", { name: /Sign in to approve this CLI connection/i })).toBeVisible();
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: /Continue with Dev Auth/i }).click();

    await expect(page.getByRole("heading", { name: "Approve CLI connection" })).toBeVisible();
    await expect(page.getByText(userCode)).toBeVisible();
    await expect(page.getByText("OpenDrop CLI")).toBeVisible();
    await expect(page.getByText("Status: pending")).toBeVisible();
    await page.getByRole("button", { name: "Approve connection" }).click();
    await expect(page.getByText("CLI connection approved. You can return to the terminal.")).toBeVisible();

    const exitCode = await waitForExit(child);
    expect(exitCode, stderr).toBe(0);
    expect(stdout).toContain(`Logged in to ${serverUrl}`);
    const config = JSON.parse(await readFile(join(home, ".opendrop", "config.json"), "utf8"));
    expect(config.server).toBe(serverUrl);
    expect(config.token).toMatch(/^od_/);

    await page.getByRole("button", { name: "View connections" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Connections/ })).toHaveAttribute("aria-selected", "true");
    const connection = page.locator(".connection", { hasText: "OpenDrop CLI" }).first();
    await expect(connection).toBeVisible();
    await connection.getByRole("button", { name: "Revoke" }).click();
    await page.getByRole("button", { name: "Revoke connection" }).click();
    await expect(connection).toContainText("Revoked");
    await expect(connection.getByRole("button", { name: "Revoke" })).toBeDisabled();
  } finally {
    if (child.exitCode === null) child.kill();
  }
});

test("zip input and drag-drop uploads publish through the UI", async ({ page }) => {
  const namespace = uniqueName("uploadpaths");
  await loginWithDevAuth(page, `${namespace}@example.com`);

  const zipSlug = uniqueName("zip-upload");
  const zipPath = await createZipFixture(zipSlug);
  await page.locator('input[accept=".zip,application/zip"]').setInputFiles(zipPath);
  await page.getByPlaceholder("slug optional").fill(zipSlug);
  await expect(page.getByText("Root index.html found.")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("assets/app.css", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await openPublishedPreview(page, zipSlug);
  await expect(page.frameLocator('iframe[title="OpenDrop preview"]').getByText("Zip fixture published")).toBeVisible();

  await page.goto("/");
  const dropSlug = uniqueName("drop-upload");
  await dropFiles(page, [
    { name: "index.html", type: "text/html", body: "<h1>Drag fixture published</h1>" },
    { name: "app.css", type: "text/css", body: "h1 { color: teal; }" }
  ]);
  await page.getByPlaceholder("slug optional").fill(dropSlug);
  await expect(page.getByText("Root index.html found.")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".manifestPath", { hasText: "app.css" })).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await openPublishedPreview(page, dropSlug);
  await expect(page.frameLocator('iframe[title="OpenDrop preview"]').getByText("Drag fixture published")).toBeVisible();
});

test("automatic validation blocks missing index and reports skipped files", async ({ page }) => {
  const namespace = uniqueName("validationowner");
  await loginWithDevAuth(page, `${namespace}@example.com`);

  await page.locator("input[type=file]").first().setInputFiles(resolve("tests/e2e/fixtures/missing-index"));
  await expect(page.getByText("Upload must contain index.html at the root.")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Publish" })).toBeDisabled();

  const skippedDir = await mkdtemp(join(tmpdir(), "opendrop-validation-"));
  await writeFile(join(skippedDir, "index.html"), "<h1>Valid shell</h1>");
  await writeFile(join(skippedDir, "notes.txt"), Array.from({ length: 25_001 }, (_, index) => `line ${index}`).join("\n"));

  await page.locator("input[type=file]").first().setInputFiles(skippedDir);
  await expect(page.getByText("1 accepted, 1 skipped")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Text file has more than 25000 lines and will be skipped.")).toBeVisible();
  await expect(page.getByText("notes.txt", { exact: true })).toBeVisible();
  await expect(page.getByText("25001 lines")).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish" })).toBeEnabled();
});
