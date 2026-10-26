import { expect, test } from "@playwright/test";
import { otpSnapshot, waitForOtp } from "../../scripts/live-auth-mailbox.mjs";

const email = process.env.LIVE_AUTH_EMAIL;
const password = process.env.LIVE_AUTH_TEST_PASSWORD;
if (!email || !/^[^@\s]+@pixelsmith\.space$/i.test(email)) throw new Error("LIVE_AUTH_EMAIL must be a disposable @pixelsmith.space address.");
if (!password || password.length < 10) throw new Error("LIVE_AUTH_TEST_PASSWORD must be configured and meet the live password policy.");

// React reports a hydration mismatch as "Hydration failed ..." in development and as a minified
// "Minified React error #418/#422/#423/#424/#425" in a production build, which is what staging runs.
// Browser errors on the signed-in pages are collected here and asserted by the last test in this file,
// which carries no LIVE-AUTH annotation so it can never change a matrix case's result.
const HYDRATION_ERROR = /hydrat|Minified React error #(?:418|422|423|424|425)\b/i;
const hydrationProblems = [];
function watchForHydrationErrors(page) {
  page.on("console", (message) => {
    if (message.type() === "error" && HYDRATION_ERROR.test(message.text())) hydrationProblems.push(`${page.url()} :: ${message.text().slice(0, 240)}`);
  });
  page.on("pageerror", (error) => {
    if (HYDRATION_ERROR.test(error.message)) hydrationProblems.push(`${page.url()} :: ${error.message.slice(0, 240)}`);
  });
}
// Give Suspense boundaries that hydrate late, and the icon-tooltip script, time to run before moving on.
async function letSignedInPageSettle(page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2_000);
}

async function startSignIn(page, returnTo) {
  await page.goto(returnTo ? `/api/auth/session-expired?returnTo=${encodeURIComponent(returnTo)}` : "/sign-in");
  await page.getByLabel("Email Address").fill(email);
  const emailSubmitButton = page.getByRole("button", { name: "Sign In" });
  await expect(emailSubmitButton).toBeEnabled({ timeout: 45_000 });
  await emailSubmitButton.click();
  await expect(page.locator('input[name="password"]')).toBeVisible();
}

async function submitPassword(page, value) {
  await page.locator('input[name="password"]').fill(value);
  await page.getByRole("button", { name: "Sign In" }).click();
}

test("LIVE-AUTH-001,003,005,006: reuse one mailbox/account through signup, OTP, login, and logout", async ({ page, context }) => {
  test.info().annotations.push({ type: "live-auth-partial-cases", description: "LIVE-AUTH-001,LIVE-AUTH-003,LIVE-AUTH-005,LIVE-AUTH-006,LIVE-AUTH-008,LIVE-AUTH-022,LIVE-AUTH-029" });
  watchForHydrationErrors(page);
  const evidence = [];
  const beforeSignup = await otpSnapshot(email, "verification code");
  await page.goto("/sign-up");
  await page.getByLabel("Email Address").fill(email);
  const signupButton = page.getByRole("button", { name: "Sign up" });
  await expect(signupButton).toBeEnabled({ timeout: 45_000 });
  await signupButton.click();
  await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
  const signupCode = await waitForOtp(email, "verification code", beforeSignup);
  // Email delivery and code redemption are exercised live, but password-reset/email-change mail are not.
  evidence.push("LIVE-AUTH-029");
  await page.locator('input[name="code"]').fill(signupCode === "000000" ? "111111" : "000000");
  await expect(page.locator(".idoc-auth-error")).toBeVisible();
  await page.reload();
  await page.locator('input[name="code"]').fill(signupCode);
  await expect(page.getByRole("heading", { name: "Create your password" })).toBeVisible();
  evidence.push("LIVE-AUTH-001");

  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/);
  await letSignedInPageSettle(page);
  // Verify a new onboarding account cannot use a direct protected deep link to skip onboarding.
  await page.goto("/dashboard/membership");
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/);
  evidence.push("LIVE-AUTH-001", "LIVE-AUTH-008");

  await page.getByRole("button").filter({ has: page.locator('[data-slot="avatar"]') }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto("/dashboard/membership");
  await expect(page).toHaveURL(/\/sign-in/);
  evidence.push("LIVE-AUTH-005", "LIVE-AUTH-006");

  await startSignIn(page);
  await submitPassword(page, `${password}-wrong`);
  await expect(page.locator(".idoc-auth-error")).toBeVisible();
  const beforeLogin = await otpSnapshot(email, "sign-in code");
  await submitPassword(page, password);
  await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
  const loginCode = await waitForOtp(email, "sign-in code", beforeLogin);
  await page.locator('input[name="code"]').fill(loginCode);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/);
  await letSignedInPageSettle(page);
  evidence.push("LIVE-AUTH-003");

  await page.getByRole("button").filter({ has: page.locator('[data-slot="avatar"]') }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  // Exercise the approved protected return destination without claiming the full
  // adversarial return-path matrix or administrator session-lifetime case.
  await startSignIn(page, "/dashboard/membership");
  const beforeSecondLogin = await otpSnapshot(email, "sign-in code");
  // The app enforces a 30-second email OTP resend cooldown after the prior sign-in.
  await page.waitForTimeout(31_000);
  await submitPassword(page, password);
  await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
  const secondLoginCode = await waitForOtp(email, "sign-in code", beforeSecondLogin);
  await page.locator('input[name="code"]').fill(secondLoginCode);
  await page.getByRole("button", { name: "Verify" }).click();
  // Fresh signups have not completed onboarding. Their mandatory onboarding gate
  // takes precedence over the saved return URL and must not be bypassed.
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/);
  // Partial LIVE-AUTH-022: approved returnTo is overridden by required onboarding;
  // malicious return-path variants still require dedicated browser cases.
  evidence.push("LIVE-AUTH-022");
});

test("no React hydration errors were reported on the signed-in pages the journey visited", async () => {
  expect(
    hydrationProblems,
    "React reported a hydration mismatch (server HTML != client render) while the journey was signed in. " +
      "This is not an auth failure; it is noise that hides real errors and re-renders part of the page.",
  ).toEqual([]);
});
