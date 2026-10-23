// Records the How to Use walkthroughs against a running site as one WebM per section, then converts each to MP4 with
// ffmpeg. Run it against staging with a DEMO member only (fake name and email, never a real member's account).
//
//   HOW_TO_BASE_URL=https://staging.idoc.club HOW_TO_STORAGE_STATE=demo-member.json \
//     node scripts/how-to-videos/record.mjs [outDir]
//
// HOW_TO_STORAGE_STATE is a Playwright storage-state file saved after signing in as the demo member
// (`npx playwright codegen --save-storage=demo-member.json <site>/sign-in`), so sign-in codes and MFA never run here.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const baseUrl = (process.env.HOW_TO_BASE_URL ?? '').replace(/\/$/, '');
const storageState = process.env.HOW_TO_STORAGE_STATE;
if (!baseUrl || !storageState) {
  console.error('Set HOW_TO_BASE_URL and HOW_TO_STORAGE_STATE.');
  process.exit(1);
}
const outDir = resolve(process.argv[2] ?? 'out/how-to-videos');
mkdirSync(outDir, { recursive: true });

const pause = (page, ms = 1800) => page.waitForTimeout(ms);
async function show(page, locator) {
  await locator.first().scrollIntoViewIfNeeded();
  await locator.first().hover();
  await pause(page);
}

// Each scene follows the steps listed for that section in lib/how-to/guide.ts.
const scenes = {
  async directory(page) {
    await page.goto(`${baseUrl}/about/members-directory`);
    await pause(page, 3000);
    await page.getByRole('tab', { name: /search directory/i }).click();
    await pause(page);
    await page.getByRole('searchbox').or(page.getByPlaceholder(/search/i)).first().fill('a');
    await pause(page, 2500);
    await show(page, page.getByRole('columnheader').first());
  },
  async contact(page) {
    await page.goto(`${baseUrl}/contact`);
    await pause(page, 3000);
    await show(page, page.getByText(/your conversations/i));
    await show(page, page.getByRole('button', { name: /start conversation/i }));
  },
  async seminars(page) {
    await page.goto(`${baseUrl}/seminars`);
    await pause(page, 3000);
    await page.getByRole('link', { name: /./ }).filter({ hasText: /seminar|course/i }).nth(1).click().catch(() => {});
    await pause(page, 3000);
    await show(page, page.getByRole('button', { name: /register/i }));
  },
  async 'my-seminars'(page) {
    await page.goto(`${baseUrl}/seminars?view=my`);
    await pause(page, 3000);
    await show(page, page.getByText(/upcoming & current/i));
    await show(page, page.getByText(/registration status/i));
  },
};

const browser = await chromium.launch();
for (const [id, scene] of Object.entries(scenes)) {
  const raw = join(outDir, `.raw-${id}`);
  rmSync(raw, { force: true, recursive: true });
  const context = await browser.newContext({
    recordVideo: { dir: raw, size: { height: 720, width: 1280 } },
    storageState,
    viewport: { height: 720, width: 1280 },
  });
  const page = await context.newPage();
  await scene(page);
  await context.close(); // flushes the recording
  const webm = join(raw, readdirSync(raw).find((name) => name.endsWith('.webm')));
  const mp4 = join(outDir, `${id}.mp4`);
  execFileSync('ffmpeg', ['-y', '-i', webm, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4], { stdio: 'ignore' });
  rmSync(raw, { force: true, recursive: true });
  console.log(`rendered ${mp4}`);
}
await browser.close();
