// Single shared visual shell for every IDOC transactional email — member-facing (verification
// codes, account links, renewal notices) and admin/super-admin system notices alike — so branding
// stays consistent in one place and a future move to admin-editable templates only needs to swap
// what's rendered inside this shell, not rewrite every call site. Deliberately dependency-free (no
// `server-only`): it is pure string rendering, safe to unit test without a database or provider.

export function renderTransactionalEmail(options: { bodyHtml: string; footerNote?: string; heading?: string }): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f9fafb;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:8px;padding:32px;">
  <tr><td>
    <h1 style="margin:0 0 24px;text-align:center;font-size:20px;color:#111827;">IDOC</h1>
    ${options.heading ? `<h2 style="margin:0 0 16px;font-size:17px;color:#111827;">${options.heading}</h2>` : ''}
    <div style="color:#374151;font-size:15px;line-height:1.6;">${options.bodyHtml}</div>
    ${options.footerNote ? `<p style="margin:24px 0 0;color:#6b7280;font-size:13px;">${options.footerNote}</p>` : ''}
  </td></tr>
</table>
</body></html>`;
}

/** A modern email CTA button, for the link-based flows (email-change verification, password reset,
 * migration activation) that need a clickable action rather than a code to copy. */
export function emailButton(href: string, label: string): string {
  return `<p style="margin:24px 0;text-align:center;"><a href="${href}" style="display:inline-block;border-radius:6px;background:#111827;padding:12px 28px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${label}</a></p>`;
}

/** The large, letter-spaced, easily copyable code block used by every OTP email. */
export function emailCode(code: string): string {
  return `<div style="margin:0 0 24px;border-radius:8px;background:#f3f4f6;padding:16px 0;text-align:center;font-size:36px;font-weight:700;letter-spacing:8px;color:#111827;">${code}</div>`;
}
