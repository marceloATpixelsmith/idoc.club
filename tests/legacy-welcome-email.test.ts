import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dashboardNavItems } from '../lib/navigation/dashboard-nav.ts';
import { HOW_TO_PATH, HOW_TO_SECTIONS, HOW_TO_SECTION_IDS, howToSectionPath, howToVideoPosterUrl, howToVideoUrl } from '../lib/how-to/guide.ts';
import { LEGACY_WELCOME_SUBJECT, renderLegacyWelcomeEmail } from '../lib/notifications/legacy-welcome-email.ts';

const BASE = 'https://idoc.club';
const previous = process.env.BASE_URL;
process.env.BASE_URL = BASE;
test.after(() => { if (previous === undefined) delete process.env.BASE_URL; else process.env.BASE_URL = previous; });

test('the welcome email links every featured area and its how-to video section', () => {
  const { html, subject } = renderLegacyWelcomeEmail({ firstName: 'Ada' });
  assert.equal(subject, LEGACY_WELCOME_SUBJECT);
  assert.match(html, /Hello Ada,/);
  assert.match(html, /idoc-logo-email\.png/);
  for (const section of HOW_TO_SECTIONS) {
    assert.ok(html.includes(`href="${BASE}${section.featureHref}"`), `${section.id} feature link`);
    assert.ok(html.includes(`href="${BASE}${howToSectionPath(section.id)}"`), `${section.id} how-to link`);
  }
  assert.ok(html.includes(`href="${BASE}${HOW_TO_PATH}"`));
});

test('the welcome email states the FEI approval and audit-only rules and the support categories', () => {
  const { html } = renderLegacyWelcomeEmail();
  assert.match(html, /not complete until FEI approves/);
  assert.match(html, /National Federation registers you with FEI/);
  assert.match(html, /to audit the course only/);
  for (const category of ['Billing/Membership', 'Seminars/Courses', 'Technical Support', 'Make a suggestion', 'Other']) assert.ok(html.includes(category), category);
  assert.match(html, /My Seminars\/Courses/);
  assert.match(html, /Upcoming &amp; current|Upcoming & current/);
});

test('a first name is escaped and a missing one falls back to a neutral greeting', () => {
  assert.ok(renderLegacyWelcomeEmail({ firstName: '<b>x</b>' }).html.includes('Hello &lt;b&gt;x&lt;/b&gt;,'));
  assert.match(renderLegacyWelcomeEmail({ firstName: '  ' }).html, /<p>Hello,<\/p>/);
});

test('support categories in the guide match the real inbox categories', () => {
  const inbox = readFileSync('lib/support/inbox-options.ts', 'utf8');
  for (const label of ['Billing/Membership', 'Seminars/Courses', 'Technical Support', 'Make a suggestion', 'Other']) assert.ok(inbox.includes(`'${label}'`), label);
});

test('guide sections are unique, cover the requested areas, and only play videos from this site or Cloudinary', () => {
  assert.deepEqual(HOW_TO_SECTIONS.map(({ id }) => id), [...HOW_TO_SECTION_IDS]);
  for (const section of HOW_TO_SECTIONS) {
    assert.ok(section.featureHref.startsWith('/'));
    assert.ok(
      section.videoSrc === null || section.videoSrc.startsWith('/how-to-videos/') || section.videoSrc === howToVideoUrl(section.id),
      `${section.id} video must be same-origin or its Cloudinary recording`,
    );
  }
});

test('Cloudinary video and poster URLs follow the upload convention', () => {
  assert.equal(howToVideoUrl('directory'), 'https://res.cloudinary.com/z6xv27qx/video/upload/f_auto,q_auto/idoc/how-to/directory');
  assert.match(howToVideoPosterUrl('my-seminars'), /^https:\/\/res\.cloudinary\.com\/z6xv27qx\/video\/upload\/[^/]+\/idoc\/how-to\/my-seminars\.jpg$/);
});

test('My IDOC navigation exposes the How to Use page', () => {
  assert.ok(dashboardNavItems().some((item) => item.href === HOW_TO_PATH && item.label === 'How to Use idoc.club'));
});

test('the welcome is queued once per account at activation, behind the launch hold', () => {
  const recovery = readFileSync('lib/membership/account-recovery.ts', 'utf8');
  assert.match(recovery, /'legacy_welcome'/);
  assert.match(recovery, /legacy-welcome:\$\{userId\}/);
  assert.match(recovery, /communicationHoldTimestamp\(\)/);
  const migration = readFileSync('lib/db/migrations/0083_legacy_welcome_notification_kind.sql', 'utf8');
  assert.match(migration, /'legacy_welcome'/);
});
