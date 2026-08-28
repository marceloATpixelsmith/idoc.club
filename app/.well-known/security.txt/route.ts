import { NextResponse } from 'next/server';
import { baseUrlForServer } from '@/lib/runtime/configuration';

// RFC 9116 vulnerability-disclosure policy, served at the well-known location a security
// researcher or automated scanner actually checks -- not just documented in the repository, which
// only a contributor would ever find. Contact reuses the existing operations-recipient env var
// (IDOC_ADMIN_NOTIFICATION_EMAIL, already documented in docs/07 §15) rather than introducing a new
// one; the literal fallback only covers a local/preview environment that hasn't set it.
export async function GET() {
  const contactEmail = process.env.IDOC_ADMIN_NOTIFICATION_EMAIL || 'webmaster@idoc.club';
  const canonical = new URL('/.well-known/security.txt', baseUrlForServer()).toString();
  const expires = '2027-08-28T00:00:00.000Z';
  const body = [
    `Contact: mailto:${contactEmail}`,
    `Expires: ${expires}`,
    'Preferred-Languages: en',
    `Canonical: ${canonical}`,
  ].join('\n') + '\n';
  return new NextResponse(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
