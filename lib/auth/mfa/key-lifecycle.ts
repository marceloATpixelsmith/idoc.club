import 'server-only';
import type postgres from 'postgres';
import { client } from '../../db/drizzle.ts';

type Sql = ReturnType<typeof postgres>;

// AUTH-CRYPTO-004: "Cryptographic records MUST identify non-secret key versions across pending,
// active, retiring, retired and compromised states; compromised keys MUST stop new and unsafe old
// use." The last half was already true before this file existed (resolveMfaEncryptionKey in
// totp.ts refuses a compromised key ID for decryption, and a compromised key can never be the
// active key -- see mfaConfiguration()'s validation in lib/runtime/configuration.ts -- so it is
// never used for new encryption either). What was missing is an explicit state per key ID rather
// than the implicit binary "usable or not" the ring previously offered.
//
// active and compromised are operator-declared config (MFA_TOTP_ACTIVE_KEY_ID,
// MFA_TOTP_COMPROMISED_KEY_IDS) -- the app cannot infer either from data alone. retired is also
// operator-declared (MFA_TOTP_RETIRED_KEY_IDS: "I have confirmed this key is fully decommissioned"),
// but unlike compromised it is not blindly trusted: this function cross-checks it against the real
// idoc.mfa_factors table and flags retiredWithActiveFactors rather than silently believing a stale
// or mistaken declaration. pending and retiring are NOT operator-declared -- they are derived
// directly from live factor usage, since that is knowable without any additional persisted history:
// a non-active, non-compromised, non-retired key with zero referencing factors has never been
// adopted (pending); one with at least one referencing factor is still needed for old decryption,
// i.e. mid-migration (retiring).
export type MfaEncryptionKeyState = 'pending' | 'active' | 'retiring' | 'retired' | 'compromised';

export type MfaEncryptionKeyLifecycle = {
  keyId: string;
  state: MfaEncryptionKeyState;
  /** Count of idoc.mfa_factors rows (any status) currently encrypted under this key ID. */
  factorCount: number;
  /** True only for a key declared MFA_TOTP_RETIRED_KEY_IDS that still has >0 referencing factors --
   * a real data-integrity anomaly (the declaration is premature or wrong), surfaced rather than
   * silently overridden either direction. */
  retiredWithActiveFactors: boolean;
};

export type MfaKeyRingConfig = {
  activeKeyId: string;
  encryptionKeys: Map<string, Buffer>;
  compromisedKeyIds: Set<string>;
  retiredKeyIds: Set<string>;
};

export async function mfaEncryptionKeyLifecycle(
  config: MfaKeyRingConfig,
  sql: Sql = client,
): Promise<MfaEncryptionKeyLifecycle[]> {
  const rows = await sql<{ encryptionKeyId: string; factorCount: string }[]>`
    select encryption_key_id as "encryptionKeyId", count(*)::text as "factorCount"
    from idoc.mfa_factors
    where factor_type = 'totp' and encryption_key_id is not null
    group by encryption_key_id
  `;
  const factorCountByKeyId = new Map(rows.map((row) => [row.encryptionKeyId, Number(row.factorCount)]));

  return [...config.encryptionKeys.keys()].map((keyId) => {
    const factorCount = factorCountByKeyId.get(keyId) ?? 0;
    if (config.compromisedKeyIds.has(keyId)) {
      return { keyId, state: 'compromised' as const, factorCount, retiredWithActiveFactors: false };
    }
    if (keyId === config.activeKeyId) {
      return { keyId, state: 'active' as const, factorCount, retiredWithActiveFactors: false };
    }
    if (config.retiredKeyIds.has(keyId)) {
      return { keyId, state: 'retired' as const, factorCount, retiredWithActiveFactors: factorCount > 0 };
    }
    return {
      keyId,
      state: factorCount > 0 ? ('retiring' as const) : ('pending' as const),
      factorCount,
      retiredWithActiveFactors: false,
    };
  });
}
