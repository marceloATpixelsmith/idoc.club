import { createHmac } from 'node:crypto';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { E2E_RECOVERY_CODE, E2E_TOTP_SECRET } from './global-setup';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function totp(secret: string) {
  let bits = 0;
  let accumulator = 0;
  const bytes: number[] = [];
  for (const character of secret) {
    accumulator = (accumulator << 5) | BASE32.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bytes.push((accumulator >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(message).digest();
  const offset = digest.at(-1)! & 15;
  const binary = ((digest[offset] & 127) << 24) | ((digest[offset + 1] & 255) << 16) |
    ((digest[offset + 2] & 255) << 8) | (digest[offset + 3] & 255);
  return String(binary % 1_000_000).padStart(6, '0');
}

test('live recovery remains constrained through replacement and acknowledgement', async ({ browser }) => {
  test.setTimeout(60_000);
  const sql = postgres(process.env.TEST_DATABASE_URL!, { max: 1 });
  const context = await browser.newContext({ storageState: '.security-e2e/recovery-administrator.json' });
  const page = await context.newPage();
  const [fixture] = await sql<{ id: number }[]>`select id from idoc.users where email='recovery-administrator@security.example.test'`;
  const before = await sql<{ count: number }[]>`select count(*)::int count from idoc.auth_sessions where user_id=${fixture.id} and revoked_at is null`;

  await page.goto('/dashboard/security');
  await page.getByRole('button', { name: 'Replace authenticator' }).click();
  await expect(page).toHaveURL(/\/mfa$/);
  await page.getByLabel('Recovery code').fill(E2E_RECOVERY_CODE);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Set up authenticator' })).toBeVisible();

  const afterRecovery = await sql<{ count: number }[]>`select count(*)::int count from idoc.auth_sessions where user_id=${fixture.id} and revoked_at is null`;
  expect(before[0].count).toBe(1);
  expect(afterRecovery[0].count).toBe(0);
  expect((await context.cookies()).some(({ name }) => name === '__Host-idoc-session')).toBe(false);
  const beforeReplacementProbe = await browser.newContext();
  await beforeReplacementProbe.addCookies((await context.cookies()).filter(({ name }) => name === 'idoc_pending_primary_mfa'));
  const beforeReplacementPage = await beforeReplacementProbe.newPage();
  await beforeReplacementPage.goto('/dashboard/admin');
  await expect(beforeReplacementPage).toHaveURL(/\/sign-in/);
  await beforeReplacementProbe.close();
  await page.getByLabel('Authenticator code').fill('000000');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.locator('.idoc-auth-error')).toContainText('incorrect');

  // The "Authenticator setup key" field is the bare base32 secret meant for an authenticator app's
  // manual-entry field, not the full otpauth:// provisioning URI (which is what a QR code encodes).
  const replacementSecret = await page.getByLabel('Authenticator setup key').inputValue();
  expect(replacementSecret).toBeTruthy();
  expect(replacementSecret).toMatch(/^[A-Z2-7]+$/);
  await page.getByLabel('Authenticator code').fill(totp(replacementSecret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText('Store these recovery codes somewhere safe.')).toBeVisible();
  const beforeAck = await sql<{ count: number }[]>`select count(*)::int count from idoc.auth_sessions where user_id=${fixture.id} and revoked_at is null`;
  expect(beforeAck[0].count).toBe(0);
  expect((await context.cookies()).some(({ name }) => name === 'idoc_pending_primary_mfa')).toBe(true);
  const beforeAcknowledgementProbe = await browser.newContext();
  await beforeAcknowledgementProbe.addCookies((await context.cookies()).filter(({ name }) => name === 'idoc_pending_primary_mfa'));
  const beforeAcknowledgementPage = await beforeAcknowledgementProbe.newPage();
  await beforeAcknowledgementPage.goto('/dashboard/admin');
  await expect(beforeAcknowledgementPage).toHaveURL(/\/sign-in/);
  await beforeAcknowledgementProbe.close();

  await page.getByLabel('I saved my recovery codes.').check();
  await page.getByRole('button', { name: 'Finish sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard\/security$/);
  const final = await sql<{ active: number; oldCodes: number; sessions: number }[]>`select
    (select count(*)::int from idoc.mfa_factors where user_id=${fixture.id} and status='active') active,
    (select count(*)::int from idoc.mfa_recovery_codes where user_id=${fixture.id} and consumed_at is not null) "oldCodes",
    (select count(*)::int from idoc.auth_sessions where user_id=${fixture.id} and revoked_at is null) sessions`;
  expect(final[0].active).toBe(1);
  expect(final[0].oldCodes).toBe(0);
  expect(final[0].sessions).toBe(1);
  expect((await context.cookies()).some(({ name }) => name === 'idoc_pending_primary_mfa')).toBe(false);
  await sql.end();
  await context.close();
});

test('real step-up action uses its isolated persisted rate-limit purpose and blocks at the limit', async ({ browser }) => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { max: 1 });
  await sql`delete from idoc.account_request_limits where purpose like 'mfa_%'`;
  const context = await browser.newContext({ storageState: '.security-e2e/super-administrator.json' });
  const page = await context.newPage();
  await page.goto('/dashboard/security');
  await page.getByRole('button', { name: 'Generate new recovery codes' }).click();
  await expect(page).toHaveURL(/\/mfa$/);

  const maxPersistedCount = async () => {
    const [row] = await sql<{ request_count: number | null }[]>`select max(request_count)::int request_count
      from idoc.account_request_limits where purpose='mfa_step_up_verify'`;
    return row?.request_count ?? 0;
  };

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.getByLabel('Authenticator code').fill('000000');
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect.poll(maxPersistedCount).toBe(attempt);
    await expect(page.locator('.idoc-auth-error')).toContainText('incorrect');
  }
  await page.getByLabel('Authenticator code').fill('000000');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect.poll(maxPersistedCount).toBe(4);
  await expect(page.locator('.idoc-auth-error')).toContainText('Too many attempts');

  const rows = await sql<{ purpose: string; request_count: number }[]>`select purpose,request_count from idoc.account_request_limits
    where purpose like 'mfa_%' order by purpose,request_count desc`;
  expect(rows.filter(({ purpose }) => purpose === 'mfa_step_up_verify')).toHaveLength(2);
  expect(rows.every(({ purpose }) => purpose === 'mfa_step_up_verify')).toBe(true);
  expect(rows.every(({ request_count }) => request_count === 4)).toBe(true);
  expect(JSON.stringify(rows)).not.toContain('000000');
  await sql.end();
  await context.close();
});

// React's dev-only Server Components runtime (the `.development.js` build `next dev` always uses;
// confirmed absent from every `.production.js` runtime bundle under node_modules) tags its own
// internal owner-stack/timing/async-sequence instrumentation with single-letter debug row-type
// markers (`D`, `J`, and others -- see react-server-dom-turbopack-server.node.development.js's
// emitDebugChunk/emitTimingChunk, which literally write `<id>:D<json>` / `<id>:J<json>`) in the
// Flight wire format embedded in each `self.__next_f.push(...)` script. That instrumentation exists
// purely for the "Open Next.js Dev Tools" panel: it is never part of the real render tree or
// hydration props (those arrive in ordinary, undecorated rows), and it is compiled out of the
// production runtime entirely, so it can never reach a real deployment. Left unstripped, it makes
// this scan below unusable: Next's own dev-only instrumentation can re-serialize a traced Server
// Component's full awaited return value (here, getUser()'s raw row) purely for the devtools panel,
// which would otherwise look identical to a genuine production-reachable leak. Rather than
// enumerate every debug row-type letter (a moving target across Next versions), detection uses the
// one marker every debug/timing row observed in practice carries -- the literal `"env":"Server"`
// field, specific to this dev-only tracing vocabulary and never part of this app's actual page
// props. This walks those rows and everything they transitively reference via Flight's chunk
// reference conventions (`"$<id>"` and `"$@<id>"`, both observed in practice), and removes only
// that debug-instrumentation subgraph before scanning -- ordinary rows (including the real
// SWR-fallback-class leak this test exists to catch) are left untouched. Next streams the Flight
// payload across many separate `self.__next_f.push(...)` script tags, and a debug row in one tag can
// reference a value chunk emitted in an *earlier* tag (observed in practice), so exclusion is
// computed once globally across every tag before any tag's rows are filtered -- computing it
// per-tag would miss exactly that cross-tag case.
function stripDevOnlyDebugFlightChunks(html: string): string {
  const pushPattern = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  const decodedByPush: string[] = [];
  for (const match of html.matchAll(pushPattern)) {
    try { decodedByPush.push(JSON.parse(`"${match[1]}"`)); } catch { decodedByPush.push(''); }
  }

  const byId = new Map<string, string>();
  for (const decoded of decodedByPush) {
    for (const row of decoded.split('\n')) {
      const match = row.match(/^([0-9a-f]+):([\s\S]*)$/);
      if (match) byId.set(match[1], match[2]);
    }
  }
  const excluded = new Set<string>();
  const queue: string[] = [];
  for (const [id, rest] of byId) {
    if (/^[A-Za-z]/.test(rest) && rest.includes('"env":"Server"')) { excluded.add(id); queue.push(id); }
  }
  while (queue.length > 0) {
    const rest = byId.get(queue.pop()!) ?? '';
    for (const referenceMatch of rest.matchAll(/"\$@?([0-9a-f]+)"/g)) {
      const referencedId = referenceMatch[1];
      if (!excluded.has(referencedId)) { excluded.add(referencedId); queue.push(referencedId); }
    }
  }

  let pushIndex = 0;
  return html.replace(pushPattern, (full) => {
    const decoded = decodedByPush[pushIndex++];
    const cleaned = decoded.split('\n').filter((row) => {
      const match = row.match(/^([0-9a-f]+):/);
      return !match || !excluded.has(match[1]);
    }).join('\n');
    return full.replace(/\[1,"(?:[^"\\]|\\.)*"\]/, `[1,${JSON.stringify(cleaned)}]`);
  });
}

test('stripDevOnlyDebugFlightChunks removes only the debug-instrumentation subgraph, never an ordinary row', () => {
  const debugValue = 'dev-only-debug-secret';
  const timingTracedValue = 'dev-only-timing-traced-secret';
  const realValue = 'genuine-hydrated-prop-secret';
  const flightPayload = [
    `1:D{"time":8.1}`,
    `2:D{"awaited":"$3","env":"Server"}`,
    `3:[["id",null,${JSON.stringify(debugValue)}]]`,
    // A "J" (async-sequence/timing) row referencing its traced value via the "$@<id>" form
    // observed in practice, distinct from the plain "$<id>" form used elsewhere.
    `6:J{"name":"","start":1,"end":2,"env":"Server","owner":"$2","value":"$@7"}`,
    `7:[["id",null,${JSON.stringify(timingTracedValue)}]]`,
    `4:["$","$L5",null,{"value":${JSON.stringify(realValue)}}]`,
  ].join('\n');
  const html = `<script>self.__next_f.push([1,${JSON.stringify(flightPayload)}])</script>`;
  const cleaned = stripDevOnlyDebugFlightChunks(html);
  expect(cleaned).not.toContain(debugValue);
  expect(cleaned).not.toContain(timingTracedValue);
  expect(cleaned).toContain(realValue);
});

test('stripDevOnlyDebugFlightChunks resolves a debug-row reference into a value chunk emitted in an earlier, separate push tag', () => {
  const crossChunkDebugValue = 'dev-only-cross-chunk-debug-secret';
  const firstTag = `<script>self.__next_f.push([1,${JSON.stringify('8:[["id",null,"' + crossChunkDebugValue + '"]]')}])</script>`;
  const secondTag = `<script>self.__next_f.push([1,${JSON.stringify('9:J{"name":"","start":1,"end":2,"env":"Server","owner":"$2","value":"$@8"}')}])</script>`;
  const cleaned = stripDevOnlyDebugFlightChunks(firstTag + secondTag);
  expect(cleaned).not.toContain(crossChunkDebugValue);
});

// AUTH-API-003: "Trusted MFA results MAY contain internal factor and failure detail, while client
// responses and inventory MUST exclude raw secrets, hashes, internal identifiers, provider secrets,
// and exact risk internals." docs/22's gap: prior evidence was source-inspection of the page
// component (a regex against the file) rather than a behavioral test that actually renders the page
// and inspects the real HTTP response. This fetches the literal server response body for a
// privileged account's own /dashboard/security page -- not the post-hydration DOM -- and scans it
// against every secret/internal value real Postgres rows for that account actually hold.
test("the real /dashboard/security HTTP response for a privileged account never contains its own raw TOTP secret, encrypted factor blob, internal factor id, password hash, or recovery-code digest", async ({ browser }) => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { max: 1 });
  const [fixture] = await sql<{ id: number; password_hash: string }[]>`
    select id, password_hash from idoc.users where email='administrator@security.example.test'`;
  const [factor] = await sql<{ factor_id: string; encrypted_secret: string }[]>`
    select factor_id, encrypted_secret from idoc.mfa_factors where user_id=${fixture.id} and status='active'`;
  const [recoveryCode] = await sql<{ recovery_code_id: string; digest: string }[]>`
    select recovery_code_id, digest from idoc.mfa_recovery_codes where user_id=${fixture.id}`;
  expect(factor.encrypted_secret).toBeTruthy();
  expect(recoveryCode.digest).toBeTruthy();

  const context = await browser.newContext({ storageState: '.security-e2e/administrator.json' });
  const page = await context.newPage();
  const response = await page.goto('/dashboard/security');
  expect(response?.ok()).toBe(true);
  const html = await response!.text();

  // Positive control: the scan below is meaningless if the page never actually rendered the
  // account's real MFA state.
  await expect(page.getByText('Authenticator app', { exact: true })).toBeVisible();
  await expect(page.getByText('Status: Configured', { exact: false })).toBeVisible();
  expect(html).toContain('Authenticator app');

  const productionReachableHtml = stripDevOnlyDebugFlightChunks(html);
  for (const secret of [
    E2E_TOTP_SECRET, factor.encrypted_secret, factor.factor_id, fixture.password_hash,
    recoveryCode.recovery_code_id, recoveryCode.digest, E2E_RECOVERY_CODE,
  ]) {
    expect(productionReachableHtml).not.toContain(secret);
  }
  await sql.end();
  await context.close();
});
