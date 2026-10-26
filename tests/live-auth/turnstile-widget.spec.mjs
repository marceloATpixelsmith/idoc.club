import { expect, test } from "@playwright/test";

// LIVE-AUTH-021 against the real staging deployment. Staging uses Cloudflare's always-pass testing
// keys (docs/security/CLAUDE_LIVE_AUTH_RUNBOOK.md), so the widget passes silently and a visitor is never
// challenged. That means this case can prove two things live, and is therefore reported as partial:
//   1. the deployed widget hands out a token without a challenge, enabling the submit button, on every
//      Turnstile-gated page, with no "security check didn't load" message; and
//   2. it fails closed and visibly when Cloudflare's script cannot load: the retry message appears and the
//      submit button stays disabled (the server-side token/hostname/action checks are covered by CI).
// An interactive challenge cannot be solved on staging; it is covered by the security e2e widget spec in
// CI and by the "Turnstile real Cloudflare check" workflow (pnpm test:turnstile-live).
// Nothing here submits a form, so no account is created and no email is sent.
const GATED_PAGES = [
  { path: "/sign-in", submit: "Sign In" },
  { path: "/sign-up", submit: "Sign up" },
  { path: "/recover-password", submit: "Continue" },
];
const NEVER_SUBMITTED_EMAIL = "turnstile-live-check@pixelsmith.space";
const FAILURE_MESSAGE = /security check didn.t load/i;

test("LIVE-AUTH-021: staging Turnstile passes silently on every gated page and fails closed, visibly, when it cannot load", async ({ page }) => {
  test.info().annotations.push({ type: "live-auth-partial-cases", description: "LIVE-AUTH-021" });

  for (const { path, submit } of GATED_PAGES) {
    await test.step(`${path}: token arrives without a challenge and the submit button enables`, async () => {
      await page.goto(path);
      await page.getByLabel("Email Address").fill(NEVER_SUBMITTED_EMAIL);
      await expect(page.getByRole("button", { name: submit, exact: true })).toBeEnabled({ timeout: 45_000 });
      await expect(page.getByText(FAILURE_MESSAGE)).toHaveCount(0);
    });
  }

  await test.step("/sign-in: with the Cloudflare script blocked it fails closed and says so", async () => {
    const submissions = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/sign-in") submissions.push(request.url());
    });
    await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
    await page.goto("/sign-in");
    await page.getByLabel("Email Address").fill(NEVER_SUBMITTED_EMAIL);
    await expect(page.getByText(FAILURE_MESSAGE)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "try again" })).toBeVisible();
    // Without a token the form cannot be submitted at all.
    await expect(page.getByRole("button", { name: "Sign In", exact: true })).toBeDisabled();
    expect(submissions).toEqual([]);
  });
});
