import { expect, type Page, test } from "@playwright/test";
import { resolve } from "node:path";

const serverUrl = process.env.OPENDROP_E2E_SERVER_URL || "http://127.0.0.1:43300";
const validSite = resolve("tests/e2e/fixtures/valid-site");

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

test("primary publish, preview, and comment flow works in this browser profile", async ({ page }) => {
  const namespace = uniqueName("matrixowner");
  const slug = uniqueName("matrix");

  await loginWithDevAuth(page, `${namespace}@example.com`);
  await page.getByPlaceholder("slug optional").fill(slug);
  await page.locator("input[type=file]").first().setInputFiles(validSite);
  await expect(page.getByText("Root index.html found.")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Publish" }).click();

  const banner = page.locator(".publishSuccessBanner");
  await expect(banner).toBeVisible({ timeout: 15_000 });
  const href = await banner.locator("a").first().getAttribute("href");
  expect(href).toContain(`/${namespace}/${slug}`);

  await page.goto(href!);
  await expect.poll(() => new URL(page.url()).pathname.replace(/\/$/, "")).toBe(`/${namespace}/${slug}`);
  await expect(page.frameLocator('iframe[title="OpenDrop preview"]').getByText("Fixture published")).toBeVisible();

  await page.locator(".roomToolbar").getByRole("button", { name: "Comment" }).click();
  await page.locator('iframe[title="OpenDrop preview"]').click({ position: { x: 80, y: 70 } });
  await page.getByPlaceholder("Add a comment").fill("Matrix browser comment");
  await page.getByLabel("Submit comment").click();
  await expect(page.locator(".commentThread", { hasText: "Matrix browser comment" })).toBeVisible();
});
