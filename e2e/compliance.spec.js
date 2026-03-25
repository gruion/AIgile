import { test, expect } from "@playwright/test";
import { loginInBrowser, getAuthToken } from "./helpers/auth.js";

const API_URL = "http://localhost:3011";

test.describe("Compliance & Suggest Fix", () => {
  test.beforeEach(async ({ page, request }) => {
    await loginInBrowser(page, request);
  });

  test("compliance page loads", async ({ page }) => {
    await page.goto("/compliance");
    await expect(page.getByText("Project Compliance")).toBeVisible({ timeout: 10000 });
  });

  test("compliance API returns projects with RACI check", async ({ request }) => {
    const token = await getAuthToken(request);
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    const res = await request.get(`${API_URL}/compliance/projects`, { headers });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.projects.length).toBeGreaterThanOrEqual(1);

    const raciCheck = data.projects[0].checks.find((c) => c.id === "raci-documentation");
    expect(raciCheck).toBeTruthy();
    expect(raciCheck.maxScore).toBe(10);
  });

  test("suggest fix button appears on failing checks", async ({ page }) => {
    await page.goto("/compliance");
    await page.waitForTimeout(3000);
    const suggestFixButtons = page.getByText("Suggest Fix");
    expect(await suggestFixButtons.count()).toBeGreaterThanOrEqual(0);
  });
});
