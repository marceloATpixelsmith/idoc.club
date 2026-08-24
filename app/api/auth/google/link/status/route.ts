import { NextResponse } from 'next/server';
import { getUser } from '@/lib/db/queries';
import { googleIdentityIsLinked } from '@/lib/auth/google-identity-linking';

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ linked: false }, { status: 401 });
  return NextResponse.json({ linked: await googleIdentityIsLinked(user.id) });
}
