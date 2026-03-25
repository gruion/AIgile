import { test, expect } from "@playwright/test";
import { loginInBrowser, getAuthToken } from "./helpers/auth.js";

const API_URL = "http://localhost:3011";

test.describe("RACI Matrix", () => {
  test.beforeEach(async ({ page, request }) => {
    await loginInBrowser(page, request);
  });

  test("RACI page loads with create buttons", async ({ page }) => {
    await page.goto("/raci");
    await expect(page.getByRole("heading", { name: "RACI Matrix" })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: "New Project RACI" })).toBeVisible();
    await expect(page.getByRole("button", { name: "New PI RACI" })).toBeVisible();
  });

  test("create project RACI from template", async ({ page }) => {
    await page.goto("/raci");
    await page.getByRole("heading", { name: "RACI Matrix" }).waitFor({ timeout: 10000 });
    await page.getByRole("button", { name: "New Project RACI" }).click();

    // Wait for editor to load - look for the legend which is always present
    await expect(page.getByText("R = Responsible")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Sprint Planning")).toBeVisible();
  });

  test("RACI cell cycling works", async ({ page }) => {
    await page.goto("/raci");
    await page.getByRole("heading", { name: "RACI Matrix" }).waitFor({ timeout: 10000 });
    await page.getByRole("button", { name: "New Project RACI" }).click();

    // Wait for editor table to render
    await expect(page.getByText("R = Responsible")).toBeVisible({ timeout: 10000 });

    // Find empty cells in table body
    const cells = page.locator("tbody td button").filter({ hasText: "·" });
    await expect(cells.first()).toBeVisible({ timeout: 5000 });

    const firstCell = cells.first();
    await firstCell.click();
    await expect(firstCell).toHaveText("R", { timeout: 3000 });

    await firstCell.click();
    await expect(firstCell).toHaveText("A", { timeout: 3000 });
  });

  test("add custom activity", async ({ page }) => {
    await page.goto("/raci");
    await page.waitForTimeout(1000);
    await page.getByText("New Project RACI").click();
    await page.waitForTimeout(1000);

    await page.getByPlaceholder("+ Add activity...").fill("Security Review");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText("Security Review")).toBeVisible();
  });

  test("RACI API CRUD works", async ({ request }) => {
    const token = await getAuthToken(request);
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    const createRes = await request.post(`${API_URL}/raci`, { data: { template: "agile-default" }, headers });
    expect(createRes.ok()).toBeTruthy();
    const matrix = await createRes.json();
    expect(matrix.activities.length).toBe(10);

    const valRes = await request.post(`${API_URL}/raci/${matrix.id}/validate`, { headers });
    const val = await valRes.json();
    expect(val.valid).toBe(false);

    await request.delete(`${API_URL}/raci/${matrix.id}`, { headers });
  });
});
