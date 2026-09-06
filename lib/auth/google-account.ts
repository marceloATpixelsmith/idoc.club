import 'server-only';

import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { client, db } from '@/lib/db/drizzle';
import { users } from '@/lib/db/schema';
import { hashPassword } from '@/lib/auth/session';
import type { GoogleOidcIdentity } from '@/lib/auth/google-oidc-reference';
import { normalizeEmail } from '@/lib/membership/validation';

export class GoogleAccountLinkRequiredError extends Error {
  constructor() {
    super('This Google identity is not linked to the existing account.');
    this.name = 'GoogleAccountLinkRequiredError';
  }
}

export class GoogleAccountNotEligibleError extends Error {
  constructor() {
    super('This account cannot sign in with Google.');
    this.name = 'GoogleAccountNotEligibleError';
  }
}

type ResolveGoogleIdentityResult = {
  newAccount: boolean;
  redirectTo: string;
  user: typeof users.$inferSelect;
};

export async function authenticateGoogleIdentity(identity: GoogleOidcIdentity): Promise<ResolveGoogleIdentityResult> {
  const existingIdentity = await client<{
    user_id: number;
  }[]>`
    select user_id
    from idoc.external_identities
    where issuer = ${identity.issuer}
      and subject = ${identity.subject}
    limit 1
  `;

  let userId = existingIdentity[0]?.user_id;
  let newAccount = false;

  if (userId) {
    await client`
      update idoc.external_identities
      set last_used_at = now()
      where issuer = ${identity.issuer}
        and subject = ${identity.subject}
    `;
  } else {
    if (!identity.email || !identity.emailVerified) throw new GoogleAccountNotEligibleError();
    const email = normalizeEmail(identity.email);

    const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existingUser) {
      // Canonical reference 1.10.0 forbids automatic email-based identity linking.
      throw new GoogleAccountLinkRequiredError();
    }

    const passwordHash = await hashPassword(randomBytes(48).toString('base64url'));
    const rows = await client<{ id: number }[]>`
      with created_user as (
        insert into idoc.users (
          email,
          password_hash,
          account_state,
          session_version,
          role,
          email_verified_at,
          created_at,
          updated_at
        ) values (
          ${email},
          ${passwordHash},
          'onboarding',
          0,
          'member',
          now(),
          now(),
          now()
        )
        returning id
      )
      insert into idoc.external_identities (
        provider,
        issuer,
        subject,
        user_id,
        email_at_link,
        created_at,
        last_used_at
      )
      select
        'google',
        ${identity.issuer},
        ${identity.subject},
        created_user.id,
        ${email},
        now(),
        now()
      from created_user
      returning user_id as id
    `;

    userId = rows[0]?.id;
    newAccount = true;
  }

  if (!userId) throw new GoogleAccountNotEligibleError();

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || !user.emailVerifiedAt || !['active', 'onboarding'].includes(user.accountState)) {
    throw new GoogleAccountNotEligibleError();
  }

  return {
    newAccount,
    redirectTo: identity.returnTo || '/dashboard',
    user,
  };
}
