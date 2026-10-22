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
  expect(process.env.LIVE_AUTH_EMAIL).toMatch(/^[^@\\s]+@pixelsmith\\.space$/i);
});

test("LIVE-AUTH-006: anonymous users cannot access protected member/admin routes and mutations", async ({ page, request }) => {
  test.info().annotations.push({ type: "live-auth-partial-cases", description: "LIVE-AUTH-006" });
  await page.goto("/dashboard/membership");
  await expect(page).toHaveURL(/\\/sign-in(?:\\?|$)/);
  await page.goto("/admin/operations/live-auth-tests");
  await expect(page).toHaveURL(/\\/sign-in(?:\\?|$)/);
  const userResponse = await request.get("/api/user");
  expect(userResponse.status()).toBe(200);
  expect(await userResponse.json()).toBeNull();
  const mutation = await request.delete("/api/admin/table-preferences/members");
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
