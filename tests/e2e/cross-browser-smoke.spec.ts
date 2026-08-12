import { test, expect } from "@playwright/test";

/**
 * Cross-browser smoke contract.
 *
 * This deliberately stays on the public login surface so WebKit/Firefox can
 * prove that the browser projects execute a real page without requiring a
 * Firebase-auth fixture. Auth-gated journey coverage remains a separate
 * readiness slice.
 */
test.describe("Cross-browser public smoke @cross-browser", () => {
  test("login exposes the main landmark and heading", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.locator('main, [role="main"]').first()).toHaveCount(1);
    await expect(page.locator("h1").first()).toBeVisible();
  });
});
