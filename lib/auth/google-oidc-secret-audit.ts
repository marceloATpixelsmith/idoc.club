import 'server-only';

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';

// AUTH-SECRET-004's "audit" property for the Google OAuth client secret: unlike a request-scoped
// action (login, role grant, MFA event), rotating this secret is a pure operator/deployment-config
// change with no application code path that runs "at the moment" it happens -- there is nothing to
// hook automatically. This is the explicit call a rotation runbook step makes instead, immediately
// after flipping GOOGLE_OAUTH_CLIENT_SECRET_ACTIVE_VERSION (see scripts/record-google-oauth-secret
// -rotation.ts). It records only non-secret version labels, matching every other "audit trail, never
// the secret value itself" convention in this codebase (compare lib/runtime/configuration.ts's
// MFA_TOTP_COMPROMISED_KEY_IDS/MFA_TOTP_RETIRED_KEY_IDS, which are also labels, never key material).
export async function recordGoogleOauthSecretRotation(input: {
  toVersion: string;
  fromVersion: string | null;
  reason: 'scheduled_rotation' | 'rollback' | 'compromise_response';
  actorId?: number | null;
}): Promise<void> {
  await db.execute(sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,before_json,after_json,reason)
    values (${input.actorId ?? null},'auth.oauth.google.client_secret.rotated','system','google-oauth-client-secret',
      ${input.fromVersion === null ? null : sql`${JSON.stringify({ version: input.fromVersion })}::jsonb`},
      ${JSON.stringify({ version: input.toVersion })}::jsonb, ${input.reason})`);
}

export async function latestGoogleOauthSecretRotation(): Promise<{ toVersion: string; fromVersion: string | null; reason: string; createdAtMs: number } | null> {
  const rows = await db.execute<{ before_json: { version: string } | null; after_json: { version: string }; reason: string; created_at: string }>(
    sql`select before_json,after_json,reason,created_at from idoc.audit_log
      where action='auth.oauth.google.client_secret.rotated' and entity_type='system' and entity_id='google-oauth-client-secret'
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
