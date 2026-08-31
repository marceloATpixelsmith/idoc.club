import { NextResponse } from 'next/server';
import { getUser } from '@/lib/db/queries';
import { googleIdentityIsLinked } from '@/lib/auth/google-identity-linking';

// Explicit no-store (AUTH-TRANSPORT-002): this reflects the caller's own session, so a shared or
// browser-back-forward cache must never serve one visitor's linked-identity state to another request.
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ linked: false }, { headers: NO_STORE, status: 401 });
  return NextResponse.json({ linked: await googleIdentityIsLinked(user.id) }, { headers: NO_STORE });
}
