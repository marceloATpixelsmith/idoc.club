import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { NewUser } from '@/lib/db/schema';
import { authSecretForServer } from '@/lib/runtime/configuration';
import 'server-only';

export { comparePasswords, hashPassword, passwordHashNeedsUpgrade } from '@/lib/auth/password-hash';

const signingKey = () => new TextEncoder().encode(authSecretForServer());

type SessionData = {
  user: { id: number; sessionVersion: number };
  expires: string;
};

export async function signToken(payload: SessionData) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1 day from now')
    .sign(signingKey());
}

export async function verifyToken(input: string) {
  const { payload } = await jwtVerify(input, signingKey(), {
    algorithms: ['HS256'],
  });
  return payload as SessionData;
}

export async function getSession() {
  const session = (await cookies()).get('session')?.value;
  if (!session) return null;
  return await verifyToken(session);
}

export async function setSession(user: NewUser) {
  const expiresInOneDay = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const session: SessionData = {
    user: { id: user.id!, sessionVersion: user.sessionVersion ?? 0 },
    expires: expiresInOneDay.toISOString(),
  };
  const encryptedSession = await signToken(session);
  (await cookies()).set('session', encryptedSession, {
    expires: expiresInOneDay,
    httpOnly: true,
    path: '/',
    secure: true,
    sameSite: 'lax',
  });
}
