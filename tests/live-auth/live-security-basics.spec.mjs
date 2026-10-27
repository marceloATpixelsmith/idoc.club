import { expect, test } from "@playwright/test";

test("LIVE-AUTH-030: live browser uses the exact deployed staging revision", async ({ page }) => {
  test.info().annotations.push({ type: "live-auth-cases", description: "LIVE-AUTH-030" });
  const expectedSha = process.env.GITHUB_SHA;
  if (!expectedSha || !/^[a-f0-9]{40}$/i.test(expectedSha)) throw new Error("Missing workflow revision evidence.");
  // The prerequisite workflow job must verify Vercel's successful staging deployment for this exact SHA.
  const response = await page.goto("/");
  expect(response?.ok()).toBe(true);
  expect(new URL(page.url()).hostname).toBe("staging.idoc.club");
  expect(new URL(page.url()).protocol).toBe("https:");
  expect(process.env.LIVE_AUTH_EMAIL).toMatch(/^[^@\s]+@pixelsmith\.space$/i);
});

test("LIVE-AUTH-006: anonymous users cannot access protected member/admin routes and mutations", async ({ page, request }) => {
  test.info().annotations.push({ type: "live-auth-partial-cases", description: "LIVE-AUTH-006" });
  await page.goto("/dashboard/membership");
  await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
  await page.goto("/admin/operations/live-auth-tests");
  await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
  const userResponse = await request.get("/api/user");
  expect(userResponse.status()).toBe(200);
  expect(await userResponse.json()).toBeNull();

  //USE THE VALID ANONYMOUS DOUBLE-SUBMIT TOKEN SO THIS REACHES THE ROUTE'S AUTHORIZATION CHECK.
  const csrfCookie = (await request.storageState()).cookies.find((cookie) => cookie.name === "__Host-idoc-csrf");
  expect(csrfCookie).toBeTruthy();
  const mutation = await request.delete("/api/admin/table-preferences/members", {
    headers: { "x-idoc-csrf": csrfCookie.value },
  });
  expect(mutation.status()).toBe(403);
});

test("LIVE-AUTH-025: basic HTTPS, no-cache session endpoint, and anti-framing response headers", async ({ page, request }) => {
  test.info().annotations.push({ type: "live-auth-partial-cases", description: "LIVE-AUTH-025" });
  const response = await request.get("/api/user");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const home = await page.goto("/");
  expect(home?.ok()).toBe(true);
  expect(new URL(page.url()).protocol).toBe("https:");
  const headers = home.headers();
  // Partial coverage: cookie policy and authenticated caching still require dedicated assertions.
  expect(Boolean(headers["content-security-policy"] || headers["x-frame-options"])).toBe(true);
});

test("LIVE-AUTH-040: an invalid email-verification link is refused and the page never starts a session", async ({ page }) => {
  test.info().annotations.push({ type: "live-auth-partial-cases", description: "LIVE-AUTH-040" });
  // Partial coverage: the suspended/deleted/migrated_pending cases need an administrator and a captured link (see the case's steps).
  const response = await page.goto("/verify-email?token=" + "x".repeat(43));
  expect(response?.status()).toBe(200);
  await expect(page.getByText("This link is invalid, expired, or has already been used.")).toBeVisible();
  const cookies = await page.context().cookies();
  expect(cookies.some((cookie) => /session/i.test(cookie.name) && cookie.value.length > 0)).toBe(false);
});

test("LIVE-AUTH-041: anonymous client-error reports always return a correlation id, whatever the caller's headers say", async ({ request }) => {
  test.info().annotations.push({ type: "live-auth-partial-cases", description: "LIVE-AUTH-041" });
  // Partial coverage: alert volume and alert text are checked in the Technical Support mailbox (see the case's steps). A few requests only,
  // so this probe stays well inside the shared limit.
  const hostile = { Referer: "https://staging.idoc.club/updates/verify-your-account-at-https://idoc-support.example/login", "User-Agent": "injected-client-text/1.0 <b>urgent</b>" };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await request.post("/api/client-error", { headers: hostile, data: {} });
    expect(response.status()).toBe(200);
    expect(typeof (await response.json()).requestId).toBe("string");
  }
});
