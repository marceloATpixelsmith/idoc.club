import 'server-only';

import { client } from '@/lib/db/drizzle';
import { GOOGLE_OIDC_PROVIDER, type GoogleOidcIdentity } from '@/lib/auth/google-oidc-reference';
import type { GoogleIdentityLinkFreshEvidence } from '@/lib/auth/google-identity-link-evidence';

export type GoogleExternalIdentityRecord = { userId: string; issuer: string; subject: string };
export type GoogleExternalIdentityAtomicLinkOutcome =
  | 'linked'
  | 'already-owned'
  | 'collision'
  | 'different-google-identity-already-linked';

export type GoogleIdentityLinkResult =
  | { status: 'linked' }
  | { status: 'already-linked' }
  | { status: 'collision' }
  | { status: 'different-google-identity-already-linked' };

export type GoogleIdentityUnlinkResult =
  | { status: 'unlinked' }
  | { status: 'not-linked' }
  | { status: 'alternate-primary-authentication-required' };

export class GoogleIdentityLinkingError extends Error {
  constructor() {
    super('Google account linking could not be completed.');
    this.name = 'GoogleIdentityLinkingError';
  }
}

function validateFreshEvidence(
  evidence: GoogleIdentityLinkFreshEvidence,
  expectedUserId: string,
  expectedPurpose: GoogleIdentityLinkFreshEvidence['purpose'],
  nowMs: number,
) {
  if (!expectedUserId || evidence.userId !== expectedUserId || evidence.purpose !== expectedPurpose || !evidence.transactionId) {
    throw new GoogleIdentityLinkingError();
  }
  const age = nowMs - evidence.verifiedAtMs;
  if (!Number.isFinite(evidence.verifiedAtMs) || age < 0 || age > 5 * 60 * 1000) throw new GoogleIdentityLinkingError();
}

async function findGoogleIdentityForUser(userId: string): Promise<GoogleExternalIdentityRecord | null> {
  const rows = await client<{ user_id: number; issuer: string; subject: string }[]>`
    select user_id, issuer, subject
    from idoc.external_identities
    where user_id=${Number(userId)} and provider='google'
    limit 1
  `;
  return rows[0] ? { userId: String(rows[0].user_id), issuer: rows[0].issuer, subject: rows[0].subject } : null;
}

async function atomicLink(input: {
  userId: string;
  subject: string;
  verificationTransactionId: string;
  verificationMethod: 'password';
}): Promise<GoogleExternalIdentityAtomicLinkOutcome> {
  return client.begin(async (sql) => {
    const issuer = GOOGLE_OIDC_PROVIDER.issuer;
    await sql`select pg_advisory_xact_lock(hashtextextended(${`google-subject:${issuer}:${input.subject}`}, 0))`;
    await sql`select pg_advisory_xact_lock(hashtextextended(${`google-user:${input.userId}:${issuer}`}, 0))`;

    const owner = await sql<{ user_id: number }[]>`
      select user_id from idoc.external_identities where issuer=${issuer} and subject=${input.subject} limit 1
    `;
    if (owner[0]) return owner[0].user_id === Number(input.userId) ? 'already-owned' : 'collision';

    const existing = await sql<{ subject: string }[]>`
      select subject from idoc.external_identities where user_id=${Number(input.userId)} and provider='google' limit 1
    `;
    if (existing[0]) return existing[0].subject === input.subject ? 'already-owned' : 'different-google-identity-already-linked';

    const inserted = await sql<{ id: number }[]>`
      insert into idoc.external_identities (provider, issuer, subject, user_id, created_at, last_used_at)
      values ('google', ${issuer}, ${input.subject}, ${Number(input.userId)}, now(), now())
      returning id
    `;
    if (!inserted[0]) throw new GoogleIdentityLinkingError();

    await sql`
      insert into idoc.audit_log (actor_id, action, entity_type, entity_id, after_json, reason)
      values (
        ${Number(input.userId)},
        'auth.google_identity.linked',
        'external_identity',
        ${String(inserted[0].id)},
        jsonb_build_object('issuer', ${issuer}, 'subject', ${input.subject}, 'verificationMethod', ${input.verificationMethod}),
        ${`fresh-verification:${input.verificationTransactionId}`}
      )
    `;
    await sql`
      insert into idoc.auth_security_notification_outbox (user_id, kind)
      values (${Number(input.userId)}, 'google_identity_linked')
    `;
    return 'linked';
  });
}

async function atomicUnlink(input: {
  userId: string;
  subject: string;
  verificationTransactionId: string;
  verificationMethod: 'password';
}): Promise<boolean> {
  if (input.verificationMethod !== 'password') return false;
  return client.begin(async (sql) => {
    const issuer = GOOGLE_OIDC_PROVIDER.issuer;
    await sql`select pg_advisory_xact_lock(hashtextextended(${`google-user:${input.userId}:${issuer}`}, 0))`;
    const current = await sql<{ id: number; subject: string }[]>`
      select id, subject from idoc.external_identities
      where user_id=${Number(input.userId)} and provider='google' and issuer=${issuer}
      for update
    `;
    if (!current[0] || current[0].subject !== input.subject) return false;

    await sql`delete from idoc.external_identities where id=${current[0].id}`;
    await sql`
      insert into idoc.audit_log (actor_id, action, entity_type, entity_id, before_json, reason)
      values (
        ${Number(input.userId)},
        'auth.google_identity.unlinked',
        'external_identity',
        ${String(current[0].id)},
        jsonb_build_object('issuer', ${issuer}, 'subject', ${input.subject}, 'verificationMethod', ${input.verificationMethod}),
        ${`fresh-verification:${input.verificationTransactionId}`}
      )
    `;
    await sql`
      insert into idoc.auth_security_notification_outbox (user_id, kind)
      values (${Number(input.userId)}, 'google_identity_unlinked')
    `;
    return true;
  });
}

export async function linkGoogleIdentity(input: {
  userId: string;
  identity: GoogleOidcIdentity;
  freshEvidence: GoogleIdentityLinkFreshEvidence;
  nowMs?: number;
}): Promise<GoogleIdentityLinkResult> {
  const nowMs = input.nowMs ?? Date.now();
  validateFreshEvidence(input.freshEvidence, input.userId, 'external_identity_link', nowMs);
  if (
    input.identity.issuer !== GOOGLE_OIDC_PROVIDER.issuer ||
    input.identity.oauthTransactionPurpose !== 'external_identity_link' ||
    input.identity.oauthAuthenticatedUserId !== input.userId
  ) throw new GoogleIdentityLinkingError();

  const outcome = await atomicLink({
    userId: input.userId,
    subject: input.identity.subject,
    verificationTransactionId: input.freshEvidence.transactionId,
    verificationMethod: input.freshEvidence.method,
  });
  if (outcome === 'already-owned') return { status: 'already-linked' };
  if (outcome === 'collision') return { status: 'collision' };
  if (outcome === 'different-google-identity-already-linked') return { status: 'different-google-identity-already-linked' };
  return { status: 'linked' };
}

export async function unlinkGoogleIdentity(input: {
  userId: string;
  freshEvidence: GoogleIdentityLinkFreshEvidence;
  nowMs?: number;
}): Promise<GoogleIdentityUnlinkResult> {
  const nowMs = input.nowMs ?? Date.now();
  validateFreshEvidence(input.freshEvidence, input.userId, 'external_identity_unlink', nowMs);
  const existing = await findGoogleIdentityForUser(input.userId);
  if (!existing) return { status: 'not-linked' };
  const removed = await atomicUnlink({
    userId: input.userId,
    subject: existing.subject,
    verificationTransactionId: input.freshEvidence.transactionId,
    verificationMethod: input.freshEvidence.method,
  });
  return removed ? { status: 'unlinked' } : { status: 'alternate-primary-authentication-required' };
}

export async function googleIdentityIsLinked(userId: number) {
  return Boolean(await findGoogleIdentityForUser(String(userId)));
}
