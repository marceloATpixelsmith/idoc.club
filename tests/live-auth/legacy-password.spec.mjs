import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { otpSnapshot, waitForOtp, activationLinkSnapshot, waitForActivationLink } from "../../scripts/live-auth-mailbox.mjs";

const noncompliant = process.env.LIVE_AUTH_LEGACY_NONCOMPLIANT_EMAIL;
const compliant = process.env.LIVE_AUTH_LEGACY_COMPLIANT_EMAIL;
const compliantPassword = process.env.LIVE_AUTH_TEST_PASSWORD;
const newPassword = compliantPassword;
const noncompliantPassword = `Legacy${createHash("sha256").update(noncompliant).digest("hex").slice(0, 16)}A1`;

if (![noncompliant, compliant].every((email) => /^[^@\s]+@pixelsmith\.space$/i.test(email || ""))) {
  throw new Error("Live legacy first-login tests require two disposable mailboxes.");
}

async function signIn(page, email, password) {
  await page.goto("/sign-in");
  await page.getByLabel("Email Address").fill(email);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.locator('input[name="password"]')).toBeVisible();
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
}

test("LIVE-AUTH-039: noncompliant imported WordPress credential forces verified replacement; compliant one upgrades seamlessly", async ({ page }) => {
  test.info().annotations.push({ type: "live-auth-cases", description: "LIVE-AUTH-039" });

  const before = await activationLinkSnapshot(noncompliant);
  await signIn(page, noncompliant, noncompliantPassword);
  await expect(page.locator(".idoc-auth-error")).toContainText("does not meet the new IDOC password requirements");
  await expect(page).toHaveURL(/\/sign-in/);
  const sessionBefore = await page.request.get("/api/user");
  expect(await sessionBefore.json()).toBeNull();

  const link = await waitForActivationLink(noncompliant, before);
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Activate your IDOC account" })).toBeVisible();
  await page.getByLabel("New Password").fill(newPassword);
  await page.getByLabel("Confirm Password").fill(newPassword);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
  await expect(page.getByText("Your account is active. Sign in with your new password to review your imported profile.")).toBeVisible();
  await expect(page.getByLabel("New Password")).toHaveCount(0);

  // The imported password is no longer accepted after the activated password replaces it.
  await signIn(page, noncompliant, noncompliantPassword);
  await expect(page.locator(".idoc-auth-error")).toContainText("Invalid email or password");

  // The compliant WordPress hash follows the original first-login OTP flow and never asks for replacement.
  const otpBefore = await otpSnapshot(compliant, "sign-in code");
  await signIn(page, compliant, compliantPassword);
  await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
  const code = await waitForOtp(compliant, "sign-in code", otpBefore);
  await page.locator('input[name="code"]').fill(code);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/dashboard\/profile|\/dashboard(?:\?|$)/);
  await expect(page.getByText("does not meet the new IDOC password requirements")).toHaveCount(0);
});
