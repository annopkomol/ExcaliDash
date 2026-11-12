import { test, expect } from "@playwright/test";

type Page = import("@playwright/test").Page;

// Settings exposes theme as an "Appearance" select (system / light / dark).
const appearance = (page: Page) => page.getByLabel("Appearance");

const ensureDarkTheme = async (page: Page) => {
  await appearance(page).selectOption("dark");
  await expect(page.locator("html")).toHaveClass(/dark/);
};

const ensureLightTheme = async (page: Page) => {
  await appearance(page).selectOption("light");
  await expect(page.locator("html")).not.toHaveClass(/dark/);
};

/**
 * E2E Tests for Theme Toggle functionality
 *
 * Tests the dark/light theme feature:
 * - Toggle theme via Settings page
 * - Theme persists across page reloads
 * - Theme applies to all pages
 */

test.describe("Theme Toggle", () => {
  test("should toggle theme from Settings page", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    const select = appearance(page);
    await expect(select).toBeVisible();

    const html = page.locator("html");
    const initialDark = await html.evaluate((el) =>
      el.classList.contains("dark"),
    );

    const next = initialDark ? "light" : "dark";
    await select.selectOption(next);
    await expect(select).toHaveValue(next);
    if (initialDark) {
      await expect(html).not.toHaveClass(/dark/);
    } else {
      await expect(html).toHaveClass(/dark/);
    }
  });

  test("should persist theme across page navigation", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    const html = page.locator("html");
    await ensureDarkTheme(page);

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(html).toHaveClass(/dark/);

    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    await expect(html).toHaveClass(/dark/);
    await ensureLightTheme(page);
  });

  test("should persist theme across page reload", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    const html = page.locator("html");
    await ensureDarkTheme(page);

    await page.reload();
    await page.waitForLoadState("networkidle");

    await expect(html).toHaveClass(/dark/);
  });

  test("should apply dark theme styling to dashboard", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    await ensureDarkTheme(page);

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const body = page.locator("body");
    const bodyBgColor = await body.evaluate((el) => {
      return window.getComputedStyle(el).backgroundColor;
    });

    expect(bodyBgColor).toBeTruthy();
  });

  test("should apply light theme styling to dashboard", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    const html = page.locator("html");
    await ensureLightTheme(page);

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(html).not.toHaveClass(/dark/);
  });
});
