import 'server-only';

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { googleOauthClientSecretVersions } from './google-oidc-reference';

const ROTATION_ACTION = 'auth.oauth.google.client_secret.rotated';
const ROTATION_ENTITY_ID = 'google-oauth-client-secret';

// AUTH-SECRET-004's "audit" property for the Google OAuth client secret: unlike a request-scoped
// action (login, role grant, MFA event), rotating this secret is a pure operator/deployment-config
// change. The Super Admin security operation explicitly confirms it after flipping
// GOOGLE_OAUTH_CLIENT_SECRET_ACTIVE_VERSION and completing a real sign-in; the CLI is the fallback.
// Both record only non-secret version labels, matching every other "audit trail, never
// the secret value itself" convention in this codebase (compare lib/runtime/configuration.ts's
// MFA_TOTP_COMPROMISED_KEY_IDS/MFA_TOTP_RETIRED_KEY_IDS, which are also labels, never key material).
export async function recordGoogleOauthSecretRotation(input: {
  toVersion: string;
  fromVersion: string | null;
  reason: 'scheduled_rotation' | 'rollback' | 'compromise_response';
  actorId?: number | null;
}): Promise<void> {
  await db.execute(sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,before_json,after_json,reason)
    values (${input.actorId ?? null},${ROTATION_ACTION},'system',${ROTATION_ENTITY_ID},
      ${input.fromVersion === null ? null : sql`${JSON.stringify({ version: input.fromVersion })}::jsonb`},
      ${JSON.stringify({ version: input.toVersion })}::jsonb, ${input.reason})`);
}

export type GoogleOauthSecretRotationEvidence = {
  activeVersion: string;
  fromVersion: string | null;
  recordedAtMs: number;
  status: 'already-recorded' | 'recorded';
};

/** Records the process's active configured version, never a browser-supplied version or secret.
 * The transaction-scoped advisory lock makes concurrent clicks converge on one immutable row. */
export async function recordActiveGoogleOauthSecretRotation(
  actorId: number,
): Promise<GoogleOauthSecretRotationEvidence> {
  const { activeVersion } = googleOauthClientSecretVersions();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ROTATION_ACTION}))`);
    const rows = await tx.execute<{
      after_json: { version: string };
      created_at: string;
    }>(sql`select after_json,created_at from idoc.audit_log
      where action=${ROTATION_ACTION} and entity_type='system' and entity_id=${ROTATION_ENTITY_ID}
      order by created_at desc, id desc limit 1`);
    const latest = rows[0];
    if (latest?.after_json.version === activeVersion) {
      return {
        activeVersion,
        fromVersion: activeVersion,
        recordedAtMs: new Date(latest.created_at).getTime(),
        status: 'already-recorded' as const,
      };
    }
    const fromVersion = latest?.after_json.version ?? null;
    const inserted = await tx.execute<{ created_at: string }>(sql`insert into idoc.audit_log(
      actor_id,action,entity_type,entity_id,before_json,after_json,reason
    ) values (
      ${actorId},${ROTATION_ACTION},'system',${ROTATION_ENTITY_ID},
      ${fromVersion === null ? null : sql`${JSON.stringify({ version: fromVersion })}::jsonb`},
      ${JSON.stringify({ version: activeVersion })}::jsonb,'scheduled_rotation'
    ) returning created_at`);
    return {
      activeVersion,
      fromVersion,
      recordedAtMs: new Date(inserted[0].created_at).getTime(),
      status: 'recorded' as const,
    };
  });
}

export async function latestGoogleOauthSecretRotation(): Promise<{ toVersion: string; fromVersion: string | null; reason: string; createdAtMs: number } | null> {
  const rows = await db.execute<{ before_json: { version: string } | null; after_json: { version: string }; reason: string; created_at: string }>(
    sql`select before_json,after_json,reason,created_at from idoc.audit_log
      where action=${ROTATION_ACTION} and entity_type='system' and entity_id=${ROTATION_ENTITY_ID}
      order by created_at desc, id desc limit 1`,
  );
  const [row] = rows;
  if (!row) return null;
  return {
    createdAtMs: new Date(row.created_at).getTime(),
    fromVersion: row.before_json?.version ?? null,
    reason: row.reason,
    toVersion: row.after_json.version,
  };
}
