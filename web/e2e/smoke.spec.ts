import { expect, test } from "@playwright/test";

test("signed-out visitors are sent to the login page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("login page asks for an email address", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel("Email address")).toBeVisible();
  await expect(page.getByRole("button", { name: "Email me a login link" })).toBeVisible();
});

test("login page explains an expired link", async ({ page }) => {
  await page.goto("/login?error=link");
  await expect(page.getByText("That login link has expired")).toBeVisible();
});

test("a login link without a code goes back to the login page", async ({ page }) => {
  await page.goto("/auth/callback");
  await expect(page).toHaveURL(/\/login\?error=link$/);
});

for (const path of ["/profile", "/membership", "/profile/member/00000000-0000-0000-0000-000000000000"]) {
  test(`${path} needs a login`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
  });
}
