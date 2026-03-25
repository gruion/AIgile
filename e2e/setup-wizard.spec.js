import { test, expect } from "@playwright/test";

test.describe("Setup Wizard", () => {
  test("setup page loads with welcome step", async ({ page }) => {
    await page.goto("/setup");
    await expect(page.getByText("Welcome to AIgileCoach")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Get Started")).toBeVisible();
  });

  test("wizard advances through steps", async ({ page }) => {
    await page.goto("/setup");
    await page.getByText("Get Started").click();

    // Step 1: Jira connection form
    await expect(page.getByText("Test Connection")).toBeVisible({ timeout: 5000 });
  });
});
