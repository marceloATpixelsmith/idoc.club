// Records the How to Use walkthroughs against a running site as one WebM per section, then converts each to MP4 with
// ffmpeg. Run it with a DEMO member only (fake name and email, never a real member's account).
//
// PRIVACY: staging.idoc.club holds real production data (docs/07), and the finished videos are public on Cloudinary.
// Every page therefore gets an init script that blurs member names and emails in the directory table and every mailto
// link, and the scenes never type a search term. Review each MP4 before uploading it. The demo account is also real
// data: delete it afterwards using the cleanup rules in docs/security/CLAUDE_LIVE_AUTH_RUNBOOK.md.
//
//   HOW_TO_BASE_URL=https://staging.idoc.club HOW_TO_STORAGE_STATE=demo-member.json \
//     node scripts/how-to-videos/record.mjs [outDir]
//
// HOW_TO_STORAGE_STATE is a Playwright storage-state file saved after signing in as the demo member. When it is unset
// but HOW_TO_DEMO_EMAIL and HOW_TO_DEMO_PASSWORD are set, this script runs sign-in.mjs first (real sign-in page, saved to
// a temp file that is deleted afterwards). It stops, rather than bypassing, a Turnstile challenge or MFA; an emailed
// 6-digit code is supplied through the file sign-in.mjs names. HOW_TO_CHROMIUM_PATH points at a preinstalled Chromium.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const baseUrl = (process.env.HOW_TO_BASE_URL ?? '').replace(/\/$/, '');
let storageState = process.env.HOW_TO_STORAGE_STATE;
let signInDir = null;
if (!storageState && baseUrl && process.env.HOW_TO_DEMO_EMAIL && process.env.HOW_TO_DEMO_PASSWORD) {
  signInDir = mkdtempSync(join(process.env.HOW_TO_TEMP_DIR ?? tmpdir(), 'how-to-state-'));
  storageState = join(signInDir, 'demo-member.json');
  execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'sign-in.mjs'), storageState], { stdio: 'inherit' });
}
if (!baseUrl || !storageState) {
  console.error('Set HOW_TO_BASE_URL and either HOW_TO_STORAGE_STATE or HOW_TO_DEMO_EMAIL + HOW_TO_DEMO_PASSWORD.');
  process.exit(1);
}
const outDir = resolve(process.argv[2] ?? 'out/how-to-videos');
mkdirSync(outDir, { recursive: true });

// Injected into every document so member rows are unreadable from the first frame, including after navigation.
const PRIVACY_CSS = `
  tbody td, tbody th, a[href^="mailto:"] { filter: blur(7px) !important; user-select: none !important; }
  input[type="search"]::placeholder { filter: none !important; }
`;
const privacyInitScript = `
  const addStyle = () => {
    const style = document.createElement('style');
    style.textContent = ${JSON.stringify(PRIVACY_CSS)};
    document.documentElement.appendChild(style);
  };
  if (document.documentElement) addStyle(); else document.addEventListener('DOMContentLoaded', addStyle);
`;

const pause = (page, ms = 1800) => page.waitForTimeout(ms);
// The cookie notice would cover the page in every video, so accept it once (essential cookies only) when it appears.
async function dismissNotice(page) {
  const accept = page.getByRole('button', { name: /^got it$/i });
  if (await accept.isVisible().catch(() => false)) await accept.click();
}
async function show(page, locator) {
  await locator.first().scrollIntoViewIfNeeded();
  await locator.first().hover();
  await pause(page);
}

// Each scene follows the steps listed for that section in lib/how-to/guide.ts.
const scenes = {
  async directory(page) {
    await page.goto(`${baseUrl}/about/members-directory`);
    await pause(page, 1500);
    await dismissNotice(page);
    await pause(page, 1500);
    // "Search Directory" is a link, not a tab. The search box is focused but never typed in (real members would match).
    await page.goto(`${baseUrl}/about/members-directory?tab=directory`);
    await pause(page, 2500);
    await page.getByRole('searchbox').first().focus();
    await pause(page, 2500);
    await show(page, page.locator('thead th').first());
  },
  async contact(page) {
    await page.goto(`${baseUrl}/contact`);
    await pause(page, 1500);
    await dismissNotice(page);
    await pause(page, 1500);
    await show(page, page.getByText(/your conversations/i));
    await show(page, page.getByRole('button', { name: /start conversation/i }));
  },
  async seminars(page) {
    await page.goto(`${baseUrl}/seminars`);
    await pause(page, 1500);
    await dismissNotice(page);
    await pause(page, 1500);
    // Result cards are links named "View <title>"; the header and calendar links have other names.
    await page.getByRole('link', { name: /^View / }).first().click();
    // The page shows an empty skeleton while it loads; start the scene only once the facts panel has rendered.
    await page.getByText(/registration deadline/i).first().waitFor({ timeout: 45_000 });
    await pause(page, 1500);
    // Dates, venue, price and deadline are in the facts panel. The Register control only appears for an active member;
    // the demo member never registers (that would create real data and possibly a payment), so show it only if present.
    await show(page, page.getByText(/registration deadline/i));
    const register = page.getByRole('button', { name: /^register/i }).or(page.getByRole('link', { name: /^register/i }));
    if (await register.count()) await show(page, register);
  },
  async 'my-seminars'(page) {
    await page.goto(`${baseUrl}/seminars?view=my`);
    await pause(page, 1500);
    await dismissNotice(page);
    await pause(page, 1500);
    await show(page, page.getByText(/upcoming & current/i));
    // Registration cards read "Status: ...". Without a fixture registration only the empty state exists.
    const status = page.getByText(/^Status:/);
    if (await status.count()) await show(page, status);
    else console.warn('my-seminars: the demo member has no registrations; give it one before publishing this video.');
  },
};

// A cold server render leaves the seminar page on an empty skeleton for seconds, so load it once off-camera first.
async function warmSeminarPage(browser) {
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/seminars`);
  const href = await page.getByRole('link', { name: /^View / }).first().getAttribute('href');
  if (href) await page.goto(new URL(href, baseUrl).toString());
  await page.getByText(/registration deadline/i).first().waitFor({ timeout: 45_000 }).catch(() => {});
  await context.close();
}

const browser = await chromium.launch({ executablePath: process.env.HOW_TO_CHROMIUM_PATH || undefined });
try {
  for (const [id, scene] of Object.entries(scenes)) {
    if (id === 'seminars') await warmSeminarPage(browser);
    const raw = join(outDir, `.raw-${id}`);
    rmSync(raw, { force: true, recursive: true });
    const context = await browser.newContext({
      recordVideo: { dir: raw, size: { height: 720, width: 1280 } },
      storageState,
      viewport: { height: 720, width: 1280 },
    });
    await context.addInitScript(privacyInitScript);
    const page = await context.newPage();
    await scene(page);
    await context.close(); // flushes the recording
    const webm = join(raw, readdirSync(raw).find((name) => name.endsWith('.webm')));
    const mp4 = join(outDir, `${id}.mp4`);
    execFileSync('ffmpeg', ['-y', '-ss', '1.5', '-i', webm, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4], { stdio: 'ignore' });
    rmSync(raw, { force: true, recursive: true });
    console.log(`rendered ${mp4}`);
  }
} finally {
  await browser.close();
  if (signInDir) rmSync(signInDir, { force: true, recursive: true }); // never leave the demo session on disk
}
