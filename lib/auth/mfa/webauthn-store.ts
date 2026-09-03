import 'server-only';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { client } from '../../db/drizzle.ts';
import type { WebAuthnCeremonyPurpose, WebAuthnCredentialRecord } from './types.ts';

type Sql = ReturnType<typeof postgres>;

type CredentialReadHook = (credential: WebAuthnCredentialRecord) => Promise<void>;
let testCredentialReadHook: CredentialReadHook | null = null;

/** Test-only synchronization at the production credential-read boundary. This lets the real
 * authentication path deterministically hold concurrent requests after both have captured the
 * same counter snapshot. It is unavailable without the integration-test safety gates and is a
 * no-op in every normal process. */
export function setWebAuthnCredentialReadHookForTest(hook: CredentialReadHook | null): void {
  if (process.env.NODE_ENV !== 'test' || !process.env.TEST_DATABASE_URL) {
    throw new Error('WebAuthn credential-read synchronization is test-only.');
  }
  testCredentialReadHook = hook;
}

function userId(subjectId: string): number | null {
  if (!/^[1-9]\d*$/.test(subjectId)) return null;
  const parsed = Number(subjectId);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function timestamp(ms: number): string {
  return new Date(ms).toISOString();
}

function timestampMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error('Invalid PostgreSQL timestamp value.');
}

function credentialRecord(row: Record<string, unknown>): WebAuthnCredentialRecord {
  return {
    credentialId: String(row.credential_id),
    factorId: String(row.factor_id),
    subjectId: String(row.user_id),
    applicationId: String(row.application_id),
    publicKey: String(row.public_key),
    signCount: Number(row.sign_count),
    transports: row.transports ? String(row.transports).split(',').filter(Boolean) : [],
    deviceType: row.device_type as WebAuthnCredentialRecord['deviceType'],
    backedUp: Boolean(row.backed_up),
    deviceName: row.device_name === null ? null : String(row.device_name),
    status: row.status as WebAuthnCredentialRecord['status'],
    createdAtMs: timestampMs(row.created_at),
    lastUsedAtMs: row.last_used_at ? timestampMs(row.last_used_at) : null,
  };
}

/** PostgreSQL storage for WebAuthn credentials and ceremony challenges. Deliberately separate from
 * PostgresMfaStore's TOTP-shaped tables (canonical WebAuthn readiness never reuses TOTP storage or
 * verification mechanics): a credential's lifecycle status lives on its paired mfa_factors row, and
 * every mutation re-validates ownership and bindings under lock, matching that store's conventions. */
export class PostgresWebAuthnStore {
  private readonly sql: Sql;

  constructor(sql: Sql = client) {
    this.sql = sql;
  }

  async createCeremonyChallenge(input: { subjectId: string; applicationId: string; purpose: WebAuthnCeremonyPurpose; challenge: string; expiresAtMs: number; nowMs: number }): Promise<string> {
    const id = userId(input.subjectId);
    if (id === null || input.expiresAtMs <= input.nowMs) throw new Error('Invalid WebAuthn ceremony challenge.');
    const ceremonyId = randomUUID();
    await this.sql`insert into idoc.webauthn_ceremony_challenges
      (ceremony_id,user_id,application_id,purpose,challenge,expires_at,created_at)
      values (${ceremonyId},${id},${input.applicationId},${input.purpose},${input.challenge},
        ${timestamp(input.expiresAtMs)},${timestamp(input.nowMs)})`;
    return ceremonyId;
  }

  async consumeCeremonyChallenge(input: { ceremonyId: string; subjectId: string; applicationId: string; purpose: WebAuthnCeremonyPurpose; nowMs: number }): Promise<string | null> {
    const id = userId(input.subjectId);
    if (id === null) return null;
    const rows = await this.sql<Record<string, unknown>[]>`
      update idoc.webauthn_ceremony_challenges set consumed_at=${timestamp(input.nowMs)}
      where ceremony_id=${input.ceremonyId} and user_id=${id} and application_id=${input.applicationId}
        and purpose=${input.purpose} and consumed_at is null and expires_at>${timestamp(input.nowMs)}
      returning challenge`;
    return rows[0] ? String(rows[0].challenge) : null;
  }

  /** Atomically creates an active mfa_factors row of type 'webauthn' paired with its credential.
   * Requires an existing active TOTP factor for the same subject: WebAuthn is an additional factor
   * for privileged accounts, never a replacement that could leave a required-MFA account with no
   * enrolled fallback if a passkey is lost. */
  async createCredential(input: {
    subjectId: string;
    applicationId: string;
    credentialId: string;
    publicKey: string;
    signCount: number;
    transports: readonly string[];
    deviceType: WebAuthnCredentialRecord['deviceType'];
    backedUp: boolean;
    deviceName: string | null;
    nowMs: number;
  }): Promise<{ status: 'created'; factorId: string } | { status: 'no-totp-fallback' | 'duplicate-credential' }> {
    const id = userId(input.subjectId);
    if (id === null) return { status: 'no-totp-fallback' };
    return this.sql.begin(async (tx) => {
      const [totp] = await tx`select factor_id from idoc.mfa_factors where user_id=${id}
        and application_id=${input.applicationId} and factor_type='totp' and status='active' for update`;
      if (!totp) return { status: 'no-totp-fallback' as const };
      const [existing] = await tx`select credential_id from idoc.webauthn_credentials
        where credential_id=${input.credentialId} for update`;
      if (existing) return { status: 'duplicate-credential' as const };
      const factorId = randomUUID();
      await tx`insert into idoc.mfa_factors
        (factor_id,user_id,application_id,factor_type,status,activated_at,created_at,updated_at)
        values (${factorId},${id},${input.applicationId},'webauthn','active',
          ${timestamp(input.nowMs)},${timestamp(input.nowMs)},${timestamp(input.nowMs)})`;
      await tx`insert into idoc.webauthn_credentials
        (credential_id,factor_id,user_id,application_id,public_key,sign_count,transports,device_type,
         backed_up,device_name,created_at)
        values (${input.credentialId},${factorId},${id},${input.applicationId},${input.publicKey},
          ${input.signCount},${input.transports.join(',') || null},${input.deviceType},${input.backedUp},
          ${input.deviceName},${timestamp(input.nowMs)})`;
      return { status: 'created' as const, factorId };
    });
  }

  async getActiveCredentials(subjectId: string, applicationId: string): Promise<WebAuthnCredentialRecord[]> {
    const id = userId(subjectId);
    if (id === null) return [];
    const rows = await this.sql<Record<string, unknown>[]>`
      select c.*, f.status from idoc.webauthn_credentials c
      join idoc.mfa_factors f on f.factor_id=c.factor_id
      where c.user_id=${id} and c.application_id=${applicationId} and f.status='active'
      order by c.created_at asc`;
    return rows.map(credentialRecord);
  }

  async getActiveCredentialById(credentialId: string, subjectId: string, applicationId: string): Promise<WebAuthnCredentialRecord | null> {
    const id = userId(subjectId);
    if (id === null) return null;
    const [row] = await this.sql<Record<string, unknown>[]>`
      select c.*, f.status from idoc.webauthn_credentials c
      join idoc.mfa_factors f on f.factor_id=c.factor_id
      where c.credential_id=${credentialId} and c.user_id=${id} and c.application_id=${applicationId}
        and f.status='active' limit 1`;
    if (!row) return null;
    const credential = credentialRecord(row);
    if (testCredentialReadHook) await testCredentialReadHook(credential);
    return credential;
  }

  /** Updates the stored signature counter and last-used timestamp after a verified authentication.
   * Rejects (returns false) if the reported counter did not strictly increase from a nonzero stored
   * value, per WebAuthn cloned-authenticator guidance -- callers must treat that as a failed
   * authentication, not merely skip the bookkeeping update. Authenticators that always report 0 (many
   * platform authenticators) are exempted, matching the spec's own allowance. */
  async updateSignCount(input: { credentialId: string; subjectId: string; applicationId: string; newCount: number; nowMs: number }): Promise<boolean> {
    const id = userId(input.subjectId);
    if (id === null) return false;
    return this.sql.begin(async (tx) => {
      const [row] = await tx<Record<string, unknown>[]>`
        select sign_count from idoc.webauthn_credentials
        where credential_id=${input.credentialId} and user_id=${id} and application_id=${input.applicationId} for update`;
      if (!row) return false;
      const stored = Number(row.sign_count);
      if (stored !== 0 && input.newCount !== 0 && input.newCount <= stored) return false;
      await tx`update idoc.webauthn_credentials set sign_count=${input.newCount}, last_used_at=${timestamp(input.nowMs)}
        where credential_id=${input.credentialId} and user_id=${id} and application_id=${input.applicationId}`;
      return true;
    });
  }

  async revokeCredential(input: { credentialId: string; subjectId: string; applicationId: string; reason: string; nowMs: number }): Promise<boolean> {
    const id = userId(input.subjectId);
    if (id === null || !input.reason.trim()) return false;
    const rows = await this.sql`
      update idoc.mfa_factors set status='revoked', revoked_at=${timestamp(input.nowMs)},
        lifecycle_reason=${input.reason}, updated_at=${timestamp(input.nowMs)}
      where factor_id=(select factor_id from idoc.webauthn_credentials
        where credential_id=${input.credentialId} and user_id=${id} and application_id=${input.applicationId})
        and user_id=${id} and application_id=${input.applicationId} and status='active'
      returning factor_id`;
    return rows.length === 1;
  }
}

export const webauthnStore = new PostgresWebAuthnStore();
