import { escapeHtml } from '@/lib/news/sanitize';

export { escapeHtml };

export function renderTransactionalEmail({ bodyHtml, heading }: { bodyHtml: string; heading: string }) {
  return `<!doctype html>
<html>
<head>
  <meta name="color-scheme" content="dark only">
  <meta name="supported-color-schemes" content="dark">
  <style>
    :root { color-scheme: dark only; supported-color-schemes: dark; }
    body, .idoc-email-bg { background-color:#050c20 !important; }
    .idoc-email-card { background-color:#0b152c !important; }
    .idoc-email-text { color:#eff2f7 !important; }
    .idoc-email-gold { color:#d3af37 !important; }
  </style>
</head>
<body bgcolor="#050c20" style="margin:0;padding:0;background:#050c20 !important;color:#eff2f7;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#050c20" class="idoc-email-bg" style="width:100%;background:#050c20 !important;">
    <tr>
      <td align="center" bgcolor="#050c20" style="padding:28px 14px;background:#050c20 !important;">
        <table role="presentation" width="640" cellspacing="0" cellpadding="0" border="0" bgcolor="#0b152c" class="idoc-email-card" style="width:100%;max-width:640px;background:#0b152c !important;border:1px solid rgba(255,255,255,.12);border-radius:8px;">
          <tr>
            <td class="idoc-email-text" style="padding:36px;color:#eff2f7 !important;">
              <div style="margin:0 0 28px;text-align:center;"><img alt="IDOC — International Dressage Officials Club" src="https://res.cloudinary.com/z6xv27qx/image/upload/v1790786199/idoc-logo-email.png" width="180" style="display:inline-block;width:180px;max-width:100%;height:auto;border:0;" /></div>
              <h1 class="idoc-email-gold" style="margin:0 0 24px;color:#d3af37 !important;font-size:24px;line-height:1.25;">${escapeHtml(heading)}</h1>
              <div class="idoc-email-text" style="color:#eff2f7 !important;font-size:16px;line-height:1.6;">${bodyHtml}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
