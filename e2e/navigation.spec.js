import { test, expect } from "@playwright/test";
import { loginInBrowser } from "./helpers/auth.js";

test.describe("Navigation & Sidebar", () => {
  test.beforeEach(async ({ page, request }) => {
    await loginInBrowser(page, request);
  });

  test("sidebar renders all navigation sections", async ({ page }) => {
    await page.goto("/");
    const sidebar = page.locator("aside");
    await expect(sidebar).toBeVisible({ timeout: 10000 });

    const sections = ["Overview", "Board Hygiene", "Sprint", "Backlog", "Team", "AI Tools"];
    for (const section of sections) {
      await expect(sidebar.getByText(section, { exact: true })).toBeVisible();
    }
  });

  test("sidebar collapse/expand works", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(2000);
    const sidebar = page.locator("aside");
    await expect(sidebar).toBeVisible({ timeout: 10000 });
    const toggleBtn = sidebar.locator("button").last();

    await toggleBtn.click();
    await expect(sidebar).toHaveClass(/w-14/);

    await toggleBtn.click();
    await expect(sidebar).toHaveClass(/w-52/);
  });

  test("all pages are reachable", async ({ page }) => {
    const pages = [
      "/", "/analytics", "/compliance", "/dor", "/backlog-refinement",
      "/planning", "/sprint-goals", "/standup", "/flow", "/sprint-review",
      "/retro", "/gantt", "/dependencies", "/health-check", "/raci",
      "/analyze", "/architecture", "/settings",
    ];
    for (const path of pages) {
      const response = await page.goto(path);
      expect(response.status()).toBe(200);
    }
  });
});
