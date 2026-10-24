// Pure module (relative imports) so it can be unit-tested without the Next.js path aliases.
import { HOW_TO_PATH, HOW_TO_SECTIONS, howToSectionPath } from '../how-to/guide.ts';
import { emailButton, emailNoticeCard, escapeHtml, idocEmailAssetUrl, renderTransactionalEmail } from './email-template.ts';

export const LEGACY_WELCOME_SUBJECT = 'Welcome to the new idoc.club: your quick guide';

// Fixed, member-neutral wording. The only personalisation is the first name, escaped before it reaches the markup.
const SECTION_INTRO: Record<(typeof HOW_TO_SECTIONS)[number]['id'], string> = {
  contact: 'Need help or have a question? Reach the IDOC team.',
  directory: 'Find and contact fellow officials worldwide.',
  seminars: 'Browse and register for IDOC and FEI courses, and keep track of your registrations.',
};

function paragraphs(lines: readonly string[]): string {
  return lines.map((line) => `<p style="margin:0 0 12px;">${escapeHtml(line)}</p>`).join('');
}

function sectionCard(section: (typeof HOW_TO_SECTIONS)[number]): string {
  const featureUrl = idocEmailAssetUrl(section.featureHref);
  const videoUrl = idocEmailAssetUrl(howToSectionPath(section.id));
  const links = `<p style="margin:14px 0 0;"><a href="${escapeHtml(featureUrl)}" style="color:#d3af37;font-weight:700;">${escapeHtml(section.featureLabel)}</a>`
    + ` &nbsp;|&nbsp; <a href="${escapeHtml(videoUrl)}" style="color:#d3af37;font-weight:700;">Watch the how-to video</a></p>`;
  return emailNoticeCard(section.title, `<p style="margin:0 0 12px;font-weight:600;">${escapeHtml(SECTION_INTRO[section.id])}</p>${paragraphs(section.summary)}${links}`);
}

export function renderLegacyWelcomeEmail(options: { firstName?: string | null } = {}): { html: string; subject: string } {
  const firstName = options.firstName?.trim();
  const guideUrl = idocEmailAssetUrl(HOW_TO_PATH);
  const bodyHtml = [
    `<p>${firstName ? `Hello ${escapeHtml(firstName)},` : 'Hello,'}</p>`,
    '<p>Welcome to the new idoc.club, and thank you for activating your account. Your account moved over from the old site. Here is a quick tour of the parts of the site you will use most.</p>',
    ...HOW_TO_SECTIONS.map(sectionCard),
    emailNoticeCard(
      'Registering for an FEI course',
      '<p style="margin:0 0 12px;">Registering with IDOC is not the end of the process for an FEI course. Your registration is <strong>not complete until FEI approves your participation</strong>, which happens after your National Federation registers you with FEI.</p>'
      + '<p style="margin:0;">FEI may approve you <strong>to audit the course only</strong>. Check the Registration Status on My Seminars/Courses, and watch for our status emails.</p>',
    ),
    '<p>Every area above has a short video on the How to Use idoc.club page in My IDOC, so you can watch exactly where to click.</p>',
    '<p><strong>Please note:</strong> you must be logged in to idoc.club to see the How to Use idoc.club page. If the button below asks you to sign in, log in with your email and password first, and you will be taken to the page.</p>',
    emailButton(guideUrl, 'How to Use idoc.club'),
  ].join('');
  return {
    html: renderTransactionalEmail({
      bodyHtml,
      footerNote: 'You are receiving this one-time welcome because your account from the old site was activated on the new idoc.club. Questions? Sign in and use Contact.',
      heading: 'Welcome to the new idoc.club',
    }),
    subject: LEGACY_WELCOME_SUBJECT,
  };
}
