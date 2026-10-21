import { expect, test } from "@playwright/test";
import { messages, waitForOtp } from "../../scripts/live-auth-mailbox.mjs";

const email = process.env.LIVE_AUTH_EMAIL;
const password = process.env.LIVE_AUTH_TEST_PASSWORD;
if (!email || !/^[^@\s]+@pixelsmith\.space$/i.test(email)) throw new Error("LIVE_AUTH_EMAIL must be a disposable @pixelsmith.space address.");
if (!password || password.length < 10) throw new Error("LIVE_AUTH_TEST_PASSWORD must be configured and meet the live password policy.");

async function startSignIn(page, returnTo) {
  await page.goto(returnTo ? `/api/auth/session-expired?returnTo=${encodeURIComponent(returnTo)}` : "/sign-in");
  await page.getByLabel("Email Address").fill(email);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.locator('input[name="password"]')).toBeVisible();
}

async function submitPassword(page, value) {
  await page.locator('input[name="password"]').fill(value);
  await page.getByRole("button", { name: "Sign In" }).click();
}

test("LIVE-AUTH-001,002,003,005,006,022,038: reuse one mailbox/account through signup, OTP, login, logout, and safe return", async ({ page, context }) => {
  test.info().annotations.push({ type: "live-auth-cases", description: "LIVE-AUTH-001,LIVE-AUTH-002,LIVE-AUTH-003,LIVE-AUTH-005,LIVE-AUTH-006,LIVE-AUTH-022,LIVE-AUTH-038" });
  const evidence = [];
  const beforeSignup = (await messages(email)).length;
  await page.goto("/sign-up");
  await page.getByLabel("Email Address").fill(email);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
  const signupCode = await waitForOtp(email, "verification code", beforeSignup);
  await page.locator('input[name="code"]').fill(signupCode === "000000" ? "111111" : "000000");
  await expect(page.locator(".idoc-auth-error")).toBeVisible();
  await page.reload();
  await page.locator('input[name="code"]').fill(signupCode);
  await expect(page.getByRole("heading", { name: "Create your password" })).toBeVisible();
  evidence.push("LIVE-AUTH-001", "LIVE-AUTH-002");

  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/);
  evidence.push("LIVE-AUTH-001");

  await page.getByRole("button").filter({ has: page.locator('[data-slot="avatar"]') }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto("/dashboard/membership");
  await expect(page).toHaveURL(/\/sign-in/);
  evidence.push("LIVE-AUTH-005", "LIVE-AUTH-006");

  await startSignIn(page);
  await submitPassword(page, `${password}-wrong`);
  await expect(page.locator(".idoc-auth-error")).toBeVisible();
  const beforeLogin = (await messages(email)).length;
  await submitPassword(page, password);
  await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
  const loginCode = await waitForOtp(email, "sign-in code", beforeLogin);
  await page.locator('input[name="code"]').fill(loginCode);
  if (await page.getByLabel(/Remember me/).count()) await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/);
  evidence.push("LIVE-AUTH-003");

  await page.getByRole("button").filter({ has: page.locator('[data-slot="avatar"]') }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await startSignIn(page, "/dashboard/membership");
  const beforeSecondLogin = (await messages(email)).length;
  await submitPassword(page, password);
  await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
  const secondLoginCode = await waitForOtp(email, "sign-in code", beforeSecondLogin);
  await page.locator('input[name="code"]').fill(secondLoginCode);
  if (await page.getByLabel(/Remember me/).count()) await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/dashboard\/security/);
  evidence.push("LIVE-AUTH-022", "LIVE-AUTH-038");
  if (evidence.length === 0) throw new Error("No live auth evidence was recorded.");
});
