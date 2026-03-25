import { test, expect } from "@playwright/test";
import { loginInBrowser, getAuthToken } from "./helpers/auth.js";

const API_URL = "http://localhost:3011";

test.describe("Settings", () => {
  test("settings page loads", async ({ page, request }) => {
    await loginInBrowser(page, request);
    await page.goto("/settings");
    // Wait for page content - settings has a heading
    await page.waitForTimeout(2000);
    const body = await page.textContent("body");
    expect(body).toContain("Settings");
  });

  test("AI settings API works", async ({ request }) => {
    const token = await getAuthToken(request);
    const headers = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };

    const getRes = await request.get(`${API_URL}/settings/ai`, { headers });
    expect(getRes.ok()).toBeTruthy();

    const saveRes = await request.post(`${API_URL}/settings/ai`, {
      headers,
      data: { provider: "mock", model: "test", enabled: false },
    });
    expect(saveRes.ok()).toBeTruthy();
  });

  test("config status API is public", async ({ request }) => {
    const res = await request.get(`${API_URL}/config/status`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty("needsSetup");
    expect(data).toHaveProperty("serverCount");
  });
});
