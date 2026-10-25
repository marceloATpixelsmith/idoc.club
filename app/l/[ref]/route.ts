import { NextResponse, type NextRequest } from 'next/server';
import { classifyUserAgent } from '@/lib/activity/user-activity-events';
import { recordUserActivity } from '@/lib/activity/user-activity';
import { sessionCookieName } from '@/lib/auth/session';
import { EMAIL_LINK_SLOTS, emailLinkKey, parseEmailLinkReference } from '@/lib/notifications/email-links';
import { emailLinkRecipient } from '@/lib/notifications/email-link-recipient';

export const dynamic = 'force-dynamic';

/** Action links in member emails land here (docs/05, docs/07). The signature proves the link was issued by this site for a
 * stored email; the click is recorded against the member it was sent to, then the visitor is sent on to the fixed
 * destination for that link. Anything unrecognised goes to the home page and reveals nothing. The destination is never taken
 * from the link, so this cannot be used as an open redirect. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
  const key = emailLinkKey();
  const reference = key ? parseEmailLinkReference(ref, key) : null;
  if (!reference) return NextResponse.redirect(new URL('/', request.url), { headers, status: 302 });

  // A HEAD request (a link checker) is not a click.
  if (request.method === 'GET') {
    try {
      const recipient = await emailLinkRecipient(reference);
      if (recipient) {
        await recordUserActivity(recipient.userId, 'email_link_clicked', {
          detail: {
            browser: classifyUserAgent(request.headers.get('user-agent')),
            host: (request.headers.get('host') ?? '').toLowerCase().slice(0, 80),
            kind: recipient.kind,
            signedIn: request.cookies.has(sessionCookieName()),
            slot: reference.slot,
          },
        });
      }
    } catch { /* recording a click must never stop the member reaching the page */ }
  }
  return NextResponse.redirect(new URL(EMAIL_LINK_SLOTS[reference.slot], request.url), { headers, status: 302 });
}
