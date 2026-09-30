// Single shared visual shell for every IDOC transactional email — member-facing and system notices.
// Keep the API stable because auth, membership and seminar delivery all use this renderer.

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function renderTransactionalEmail(options: { bodyHtml: string; footerNote?: string; heading?: string }): string {
  return `<!doctype html>
<html>
<head>
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <style>
    :root { color-scheme: light dark; supported-color-schemes: light dark; }
    body, .idoc-email-bg { background:#050c20 !important; background-color:#050c20 !important; }
    .idoc-email-card { background:#0b152c !important; background-color:#0b152c !important; }
    .idoc-email-text { color:#eff2f7 !important; }
    .idoc-email-gold { color:#d3af37 !important; }
    @media (prefers-color-scheme: dark) {
      body, .idoc-email-bg { background:#050c20 !important; background-color:#050c20 !important; }
      .idoc-email-card { background:#0b152c !important; background-color:#0b152c !important; }
      .idoc-email-text { color:#eff2f7 !important; }
      .idoc-email-gold { color:#d3af37 !important; }
    }
    [data-ogsc] .idoc-email-bg { background:#050c20 !important; background-color:#050c20 !important; }
    [data-ogsc] .idoc-email-card { background:#0b152c !important; background-color:#0b152c !important; }
    [data-ogsc] .idoc-email-text { color:#eff2f7 !important; }
    [data-ogsc] .idoc-email-gold { color:#d3af37 !important; }
  </style>
</head>
<body bgcolor="#050c20" style="margin:0;padding:0;background:#050c20 !important;color:#eff2f7;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#050c20" class="idoc-email-bg" style="width:100%;background:#050c20 !important;">
    <tr><td align="center" bgcolor="#050c20" style="padding:28px 14px;background:#050c20 !important;">
      <table role="presentation" width="640" cellspacing="0" cellpadding="0" border="0" bgcolor="#0b152c" class="idoc-email-card" style="width:100%;max-width:640px;background:#0b152c !important;border:1px solid rgba(255,255,255,.12);border-radius:8px;">
        <tr><td class="idoc-email-text" style="padding:36px;color:#eff2f7 !important;">
          <div style="margin:0 0 28px;text-align:center;"><img alt="IDOC — International Dressage Officials Club" src="https://res.cloudinary.com/z6xv27qx/image/upload/v1790786199/idoc-logo-email.png" width="180" style="display:inline-block;width:180px;max-width:100%;height:auto;border:0;" /></div>
          ${options.heading ? `<h2 class="idoc-email-gold" style="margin:0 0 24px;color:#d3af37 !important;font-size:24px;line-height:1.25;">${escapeHtml(options.heading)}</h2>` : ''}
          <div class="idoc-email-text" style="color:#eff2f7 !important;font-size:16px;line-height:1.6;">${options.bodyHtml}</div>
          ${options.footerNote ? `<p style="margin:24px 0 0;color:#aeb8ca;font-size:13px;">${options.footerNote}</p>` : ''}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function emailButton(href: string, label: string): string {
  return `<p style="margin:24px 0;text-align:center;"><a href="${href}" style="display:inline-block;border-radius:6px;background:#d3af37;padding:12px 28px;font-size:14px;font-weight:600;color:#050c20;text-decoration:none;">${label}</a></p>`;
}

export function emailCode(code: string): string {
  return `<div style="margin:0 0 24px;border-radius:8px;background:#050c20;border:1px solid rgba(255,255,255,.12);padding:16px 0;text-align:center;font-size:36px;font-weight:700;letter-spacing:8px;color:#d3af37;">${code}</div>`;
}
