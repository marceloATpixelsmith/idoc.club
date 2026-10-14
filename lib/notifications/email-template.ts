// Shared visual system for every IDOC transactional email.
// Keep brand constants and reusable presentation helpers here so visual changes cascade everywhere.

export const IDOC_EMAIL_COLORS = {
  background: '#050c20',
  card: '#0b152c',
  border: '#343d55',
  gold: '#d3af37',
  muted: '#aeb8ca',
  text: '#eff2f7',
} as const;

// Email images are served from this app's own /public as PNGs (many mail clients block SVG, and the third-party
// image host that used to serve the icons stopped resolving). BASE_URL is the per-environment origin; production
// is the fallback so previews/tests without it still render.
export function idocEmailAssetUrl(path: string, environment: NodeJS.ProcessEnv = process.env): string {
  const origin = environment.BASE_URL?.trim().replace(/\/+$/, '') || 'https://idoc.club';
  return `${origin}${path}`;
}

const emailIcon = (file: string) => idocEmailAssetUrl(`/email-icons/${file}.png`);

// Getters so the origin is read when an email is built, not when this module first loads. Gold (#d3af37) 40px PNGs,
// shown at 20px. The keys mirror the lucide icons used on the website's seminar/membership detail cards.
export const IDOC_EMAIL_ICONS = {
  get banknote() { return emailIcon('banknote'); },
  get calendar() { return emailIcon('calendar'); },
  get deadline() { return emailIcon('calendar-clock'); },
  get flag() { return emailIcon('flag'); },
  get language() { return emailIcon('languages'); },
  get layers() { return emailIcon('layers'); },
  get location() { return emailIcon('map-pin'); },
  get users() { return emailIcon('users'); },
};

// The white FEI wordmark as a PNG (306x48, shown at 24px high), matching the FEI badge on the seminar details page.
export function idocEmailFeiLogoUrl(environment: NodeJS.ProcessEnv = process.env): string {
  return idocEmailAssetUrl('/fei-logo-email.png', environment);
}

export function idocEmailLogoUrl(environment: NodeJS.ProcessEnv = process.env): string {
  return idocEmailAssetUrl('/idoc-logo-email.png', environment);
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function renderTransactionalEmail(options: { bodyHtml: string; footerNote?: string; heading?: string }): string {
  return `<!doctype html>
<html>
<head>
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root { color-scheme: light dark; supported-color-schemes: light dark; }
    body, table, td, a, p, div, h1, h2, h3 { font-family:'Barlow',Arial,Helvetica,sans-serif !important; }
    body, .idoc-email-bg { background:${IDOC_EMAIL_COLORS.background} !important; background-color:${IDOC_EMAIL_COLORS.background} !important; }
    .idoc-email-card { background:${IDOC_EMAIL_COLORS.card} !important; background-color:${IDOC_EMAIL_COLORS.card} !important; }
    .idoc-email-text { color:${IDOC_EMAIL_COLORS.text} !important; }
    .idoc-email-gold { color:${IDOC_EMAIL_COLORS.gold} !important; }
    @media (prefers-color-scheme: dark) {
      body, .idoc-email-bg { background:${IDOC_EMAIL_COLORS.background} !important; background-color:${IDOC_EMAIL_COLORS.background} !important; }
      .idoc-email-card { background:${IDOC_EMAIL_COLORS.card} !important; background-color:${IDOC_EMAIL_COLORS.card} !important; }
      .idoc-email-text { color:${IDOC_EMAIL_COLORS.text} !important; }
      .idoc-email-gold { color:${IDOC_EMAIL_COLORS.gold} !important; }
    }
    [data-ogsc] .idoc-email-bg { background:${IDOC_EMAIL_COLORS.background} !important; background-color:${IDOC_EMAIL_COLORS.background} !important; }
    [data-ogsc] .idoc-email-card { background:${IDOC_EMAIL_COLORS.card} !important; background-color:${IDOC_EMAIL_COLORS.card} !important; }
    [data-ogsc] .idoc-email-text { color:${IDOC_EMAIL_COLORS.text} !important; }
    [data-ogsc] .idoc-email-gold { color:${IDOC_EMAIL_COLORS.gold} !important; }
  </style>
</head>
<body bgcolor="${IDOC_EMAIL_COLORS.background}" style="margin:0;padding:0;background:${IDOC_EMAIL_COLORS.background} !important;color:${IDOC_EMAIL_COLORS.text};font-family:'Barlow',Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${IDOC_EMAIL_COLORS.background}" class="idoc-email-bg" style="width:100%;background:${IDOC_EMAIL_COLORS.background} !important;">
    <tr><td align="center" bgcolor="${IDOC_EMAIL_COLORS.background}" style="padding:28px 14px;background:${IDOC_EMAIL_COLORS.background} !important;">
      <table role="presentation" width="640" cellspacing="0" cellpadding="0" border="0" bgcolor="${IDOC_EMAIL_COLORS.card}" class="idoc-email-card" style="width:100%;max-width:640px;background:${IDOC_EMAIL_COLORS.card} !important;border:1px solid ${IDOC_EMAIL_COLORS.border};border-radius:8px;">
        <tr><td class="idoc-email-text" style="padding:36px;color:${IDOC_EMAIL_COLORS.text} !important;font-family:'Barlow',Arial,Helvetica,sans-serif;">
          <div style="margin:0 0 28px;text-align:center;"><img alt="IDOC — International Dressage Officials Club" src="${escapeHtml(idocEmailLogoUrl())}" width="180" style="display:inline-block;width:180px;max-width:100%;height:auto;border:0;" /></div>
          ${options.heading ? `<h2 class="idoc-email-gold" style="margin:0 0 24px;color:${IDOC_EMAIL_COLORS.gold} !important;font-family:'Barlow',Arial,Helvetica,sans-serif;font-size:26px;font-weight:700;line-height:1.25;">${escapeHtml(options.heading)}</h2>` : ''}
          <div class="idoc-email-text" style="color:${IDOC_EMAIL_COLORS.text} !important;font-family:'Barlow',Arial,Helvetica,sans-serif;font-size:16px;line-height:1.65;">${options.bodyHtml}</div>
          ${options.footerNote ? `<p style="margin:28px 0 0;color:${IDOC_EMAIL_COLORS.muted};font-family:'Barlow',Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;">${options.footerNote}</p>` : ''}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function emailButton(href: string, label: string): string {
  const buttonLabel = escapeHtml(label.toUpperCase());
  return `<p style="margin:26px 0;text-align:center;"><a href="${escapeHtml(href)}" style="display:inline-block;border-radius:9999px;background:${IDOC_EMAIL_COLORS.gold};padding:13px 28px;font-family:'Barlow',Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;line-height:1.2;letter-spacing:.08em;text-transform:uppercase;color:${IDOC_EMAIL_COLORS.background};text-decoration:none;">${buttonLabel}</a></p>`;
}

export function emailCode(code: string): string {
  return `<div style="margin:0 0 24px;border-radius:8px;background:${IDOC_EMAIL_COLORS.background};border:1px solid ${IDOC_EMAIL_COLORS.border};padding:16px 0;text-align:center;font-family:'Barlow',Arial,Helvetica,sans-serif;font-size:36px;font-weight:700;letter-spacing:8px;color:${IDOC_EMAIL_COLORS.gold};">${escapeHtml(code)}</div>`;
}

export function emailInfoRow(iconUrl: string, label: string, value: string): string {
  return `<tr>
    <td width="48" style="width:48px;padding:17px 8px 17px 18px;border-bottom:1px solid ${IDOC_EMAIL_COLORS.border};vertical-align:middle;">
      <img alt="" src="${escapeHtml(iconUrl)}" width="20" height="20" style="display:block;width:20px;height:20px;border:0;" />
    </td>
    <td style="padding:17px 18px 17px 4px;border-bottom:1px solid ${IDOC_EMAIL_COLORS.border};vertical-align:middle;">
      <div class="idoc-email-gold" style="margin:0 0 2px;color:${IDOC_EMAIL_COLORS.gold} !important;font-family:'Barlow',Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;">${escapeHtml(label)}</div>
      <div class="idoc-email-text" style="color:${IDOC_EMAIL_COLORS.text} !important;font-family:'Barlow',Arial,Helvetica,sans-serif;font-size:16px;line-height:1.45;">${escapeHtml(value)}</div>
    </td>
  </tr>`;
}

export function emailInfoCard(rows: string): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${IDOC_EMAIL_COLORS.background}" style="width:100%;margin:24px 0;border-collapse:separate;border-spacing:0;background:${IDOC_EMAIL_COLORS.background};border:1px solid ${IDOC_EMAIL_COLORS.border};border-radius:8px;overflow:hidden;">${rows}</table>`;
}

export function emailNoticeCard(title: string, bodyHtml: string): string {
  return `<div style="margin:24px 0;background:${IDOC_EMAIL_COLORS.background};border:1px solid ${IDOC_EMAIL_COLORS.border};border-radius:8px;padding:20px 22px;">
    <div class="idoc-email-gold" style="margin:0 0 8px;color:${IDOC_EMAIL_COLORS.gold} !important;font-family:'Barlow',Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;">${escapeHtml(title)}</div>
    <div class="idoc-email-text" style="color:${IDOC_EMAIL_COLORS.text} !important;font-family:'Barlow',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;">${bodyHtml}</div>
  </div>`;
}
