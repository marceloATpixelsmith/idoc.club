import 'server-only';

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';

// AUTH-SECRET-003: the dedicated audit trail this row's gap named as missing -- a compromise-driven
// key removal previously generated no audit event at all. This fires only when a compromised key is
// actually presented for use (someone attempts to decrypt a factor still encrypted under it), not
// merely when an operator marks a key compromised in configuration (that action has no application
// runtime to audit against -- it is a deployment/environment-variable change, covered instead by
// standard secret-rotation change-management, per docs/07).
export async function auditCompromisedMfaKeyRejection(subjectId: string, keyId: string) {
  await db.execute(sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,reason)
    values(${Number(subjectId)},'auth.mfa.compromised_key_rejected','user',${subjectId},${keyId})`);
}
