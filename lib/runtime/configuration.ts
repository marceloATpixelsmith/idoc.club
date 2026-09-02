import 'server-only';

type Environment = Partial<Record<string, string | undefined>>;
const MIN_SECRET_LENGTH = 32;

function required(environment: Environment, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Invalid production configuration: ${name}.`);
  return value;
}

function secret(environment: Environment, name: string) {
  const value = required(environment, name);
  if (value.length < MIN_SECRET_LENGTH) throw new Error(`Invalid production configuration: ${name}.`);
  return value;
}

function url(environment: Environment, name: string, protocols: string[]) {
  const value = required(environment, name);
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error(`Invalid production configuration: ${name}.`); }
  if (!protocols.includes(parsed.protocol) || !parsed.hostname) throw new Error(`Invalid production configuration: ${name}.`);
  return value;
}

export function databaseUrlForServer(environment: Environment = process.env) {
  return url(environment, 'POSTGRES_URL', ['postgres:', 'postgresql:']);
}

export function stripeKeyForServer(environment: Environment = process.env) {
  const value = required(environment, 'STRIPE_SECRET_KEY');
  // sk_ = full-access secret key; rk_ = a dashboard-scoped restricted key. Both are legitimate
  // Stripe API credentials; restricted keys are the more security-conscious choice.
  if (!/^(?:sk|rk)_(?:test|live)_[A-Za-z0-9]{16,}$/.test(value)) throw new Error('Invalid production configuration: STRIPE_SECRET_KEY.');
  return value;
}

function productId(environment: Environment, name: string) {
  const value = required(environment, name);
  if (!/^prod_[A-Za-z0-9_-]+$/.test(value)) throw new Error(`Invalid production configuration: ${name}.`);
  return value;
}

export function stripeRecurringProductIdForServer(environment: Environment = process.env) { return productId(environment, 'STRIPE_RECURRING_PRODUCT_ID'); }
export function stripeOneTimeProductIdForServer(environment: Environment = process.env) { return productId(environment, 'STRIPE_ONE_TIME_PRODUCT_ID'); }

export function authSecretForServer(environment: Environment = process.env) { return secret(environment, 'AUTH_SECRET'); }

// AUTH-CRYPTO-005: session-token signing previously had no rotation overlap at all -- rotating
// AUTH_SECRET was a hard cutover that invalidated every outstanding session JWT immediately (see
// docs/07 §15.1). AUTH_SECRET_RETIRED_KEYS is optional; when unset this changes nothing, since the
// ring is just [AUTH_SECRET]. When set, it lists prior AUTH_SECRET values that remain valid for
// *verifying* (never signing) session tokens, so an outstanding session survives rotation until it
// naturally re-signs under the new active key on its next activity refresh (middleware.ts) or expires
// on its own absolute lifetime, whichever comes first. The active key is always index 0 and is always
// AUTH_SECRET itself -- there is no separate "active key ID" concept here, unlike the TOTP ring,
// because session tokens have never carried a key identifier and adding one is unnecessary complexity
// for a value that only ever needs "current" plus a short list of "still acceptable."
export function authSecretRingForServer(environment: Environment = process.env): string[] {
  const activeKey = authSecretForServer(environment);
  const raw = environment.AUTH_SECRET_RETIRED_KEYS?.trim();
  if (!raw) return [activeKey];
  let serialized: unknown;
  try { serialized = JSON.parse(raw); } catch {
    throw new Error('Invalid production configuration: AUTH_SECRET_RETIRED_KEYS.');
  }
  if (!Array.isArray(serialized) || serialized.some((value) => typeof value !== 'string' || value.length < MIN_SECRET_LENGTH)) {
    throw new Error('Invalid production configuration: AUTH_SECRET_RETIRED_KEYS.');
  }
  const retired = (serialized as string[]).filter((key) => key !== activeKey);
  return [activeKey, ...retired];
}

export function baseUrlForServer(environment: Environment = process.env) {
  const value = url(environment, 'BASE_URL', environment.NODE_ENV === 'production' ? ['https:'] : ['http:', 'https:']);
  const parsed = new URL(value);
  if (parsed.protocol === 'http:' && !['127.0.0.1', '[::1]', 'localhost'].includes(parsed.hostname)) {
    throw new Error('Invalid production configuration: BASE_URL.');
  }
  return value;
}
export function cronSecretForServer(environment: Environment = process.env) { return secret(environment, 'CRON_SECRET'); }
// Deliberately not required()-gated: this is a user-facing support contact for persistent-error UX
// copy, not a security-critical secret or endpoint, so an unset value must not fail a production
// build closed -- it falls back to a real, monitored address instead. Distinct from
// IDOC_ADMIN_NOTIFICATION_EMAIL (app/.well-known/security.txt/route.ts), which is an
// operator/security-researcher contact, not a member-facing support value.
export function supportEmailForServer(environment: Environment = process.env) {
  return environment.SUPPORT_EMAIL?.trim() || 'support@idoc.club';
}
// Not routed through secret()'s 32-character minimum: unlike the self-generated secrets below
// (CRON_SECRET, RATE_LIMIT_HASH_KEY, TURNSTILE_SECRET_KEY), this is a third-party-issued Mandrill
// API key in a fixed, shorter format we don't control -- real keys are commonly ~22 characters, so
// that generic minimum rejected a genuinely valid, correctly configured key as "not configured."
export function mailchimpApiKeyForServer(environment: Environment = process.env) { return required(environment, 'MAILCHIMP_TRANSACTIONAL_API_KEY'); }
export function rateLimitHashKeyForServer(environment: Environment = process.env) { return secret(environment, 'RATE_LIMIT_HASH_KEY'); }
export function turnstileSecretKeyForServer(environment: Environment = process.env) { return secret(environment, 'TURNSTILE_SECRET_KEY'); }

export function loginDeviceTrustDigestKeyForServer(environment: Environment = process.env) {
  return base64Key(environment, 'LOGIN_DEVICE_TRUST_DIGEST_KEY');
}

function base64Key(environment: Environment, name: string, minimumBytes = 32) {
  const value = required(environment, name);
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`Invalid production configuration: ${name}.`);
  const key = Buffer.from(value, 'base64url');
  // Buffer's decoder is deliberately forgiving. Require an unpadded canonical base64url
  // round trip so punctuation, truncation, and non-zero trailing bits cannot be accepted.
  if (key.length < minimumBytes || key.toString('base64url') !== value) {
    throw new Error(`Invalid production configuration: ${name}.`);
  }
  return key;
}

// AUTH-REMEMBER-001: opt-in, off by default -- an unset REMEMBER_TOTP_DEVICE_ENABLED must never
// force a new required secret onto a deployment that doesn't use this feature. Only once explicitly
// enabled does the digest key become a fail-closed required() value, matching every other MFA
// secret in this file.
function rememberedTotpDeviceConfiguration(environment: Environment) {
  const enabled = (environment.REMEMBER_TOTP_DEVICE_ENABLED ?? '').trim().toLowerCase() === 'true';
  if (!enabled) return { days: 30, digestSecret: null as Buffer | null, enabled: false };
  const daysRaw = (environment.REMEMBER_TOTP_DEVICE_DAYS ?? '30').trim();
  const days = Number(daysRaw);
  if (!Number.isInteger(days) || days <= 0 || days > 90) {
    throw new Error('Invalid production configuration: REMEMBER_TOTP_DEVICE_DAYS.');
  }
  return { days, digestSecret: base64Key(environment, 'MFA_REMEMBERED_DEVICE_DIGEST_KEY') as Buffer | null, enabled: true };
}

// AUTH-SECRET-003: distinguishes "compromised" from "removed" for a TOTP key ID. Removing a key ID
// from MFA_TOTP_ENCRYPTION_KEYS entirely is all-or-nothing -- every factor still encrypted under it
// becomes permanently undecryptable, locking those users out with no recovery path but support
// intervention. Marking a key compromised instead keeps its material in the ring (so this fail-closed
// validation and any future migration tooling can still see it) while resolveMfaEncryptionKey
// (lib/auth/mfa/totp.ts) refuses to use it for decryption, giving affected users a controlled
// "re-enroll" outcome instead of an opaque failure, and giving operators a dedicated audit trail
// (AUTH-OPERATIONS-004-style auth_security_notification_outbox/audit_log entries, written at the
// call sites in app/(login)/mfa/actions.ts and app/(login)/recover-password/actions.ts) for exactly
// when a since-compromised key was actually presented for use, not just when it was retired.
function keyIdSet(environment: Environment, name: string, encryptionKeys: Map<string, Buffer>, activeKeyId: string): Set<string> {
  const raw = environment[name]?.trim();
  if (!raw) return new Set();
  let serialized: unknown;
  try { serialized = JSON.parse(raw); } catch {
    throw new Error(`Invalid production configuration: ${name}.`);
  }
  if (!Array.isArray(serialized) || serialized.some((value) => typeof value !== 'string')) {
    throw new Error(`Invalid production configuration: ${name}.`);
  }
  const keyIds = new Set(serialized as string[]);
  // A key ID absent from the ring is meaningless here (likely an operator typo) and the active key
  // can never appear in either list -- it is, by definition, the key new encryptions still trust; an
  // operator retiring or compromising it must rotate MFA_TOTP_ACTIVE_KEY_ID to a different ring entry
  // first. Both fail closed rather than silently doing nothing.
  for (const keyId of keyIds) {
    if (!encryptionKeys.has(keyId)) throw new Error(`Invalid production configuration: ${name}.`);
  }
  if (keyIds.has(activeKeyId)) throw new Error(`Invalid production configuration: ${name}.`);
  return keyIds;
}

function compromisedMfaKeyIds(environment: Environment, encryptionKeys: Map<string, Buffer>, activeKeyId: string): Set<string> {
  return keyIdSet(environment, 'MFA_TOTP_COMPROMISED_KEY_IDS', encryptionKeys, activeKeyId);
}

// AUTH-CRYPTO-004: an operator-declared complement to compromisedMfaKeyIds -- a key ID the operator
// has confirmed is fully decommissioned (mfaEncryptionKeyLifecycle in lib/auth/mfa/key-lifecycle.ts
// verifies this against the real idoc.mfa_factors table and flags it if any factor still references
// a key declared retired here, rather than silently trusting the declaration). Distinct from a key
// that is merely unreferenced today but never explicitly retired -- see key-lifecycle.ts's
// pending/retiring distinction, which is derived from live factor usage, not operator declaration.
function retiredMfaKeyIds(environment: Environment, encryptionKeys: Map<string, Buffer>, activeKeyId: string): Set<string> {
  return keyIdSet(environment, 'MFA_TOTP_RETIRED_KEY_IDS', encryptionKeys, activeKeyId);
}

/** Server-only cryptographic material for the live canonical MFA flow. */
export function mfaConfiguration(environment: Environment = process.env) {
  const activeKeyId = required(environment, 'MFA_TOTP_ACTIVE_KEY_ID');
  if (!/^[A-Za-z0-9_-]{1,30}$/.test(activeKeyId)) throw new Error('Invalid production configuration: MFA_TOTP_ACTIVE_KEY_ID.');
  let serialized: unknown;
  try { serialized = JSON.parse(required(environment, 'MFA_TOTP_ENCRYPTION_KEYS')); } catch {
    throw new Error('Invalid production configuration: MFA_TOTP_ENCRYPTION_KEYS.');
  }
  if (!serialized || Array.isArray(serialized) || typeof serialized !== 'object') {
    throw new Error('Invalid production configuration: MFA_TOTP_ENCRYPTION_KEYS.');
  }
  const encryptionKeys = new Map<string, Buffer>();
  for (const [keyId, material] of Object.entries(serialized)) {
    if (!/^[A-Za-z0-9_-]{1,30}$/.test(keyId) || typeof material !== 'string') {
      throw new Error('Invalid production configuration: MFA_TOTP_ENCRYPTION_KEYS.');
    }
    if (!/^[A-Za-z0-9_-]+$/.test(material)) {
      throw new Error('Invalid production configuration: MFA_TOTP_ENCRYPTION_KEYS.');
    }
    const key = Buffer.from(material, 'base64url');
    if (key.toString('base64url') !== material) {
      throw new Error('Invalid production configuration: MFA_TOTP_ENCRYPTION_KEYS.');
    }
    if (key.length !== 32) throw new Error('Invalid production configuration: MFA_TOTP_ENCRYPTION_KEYS.');
    encryptionKeys.set(keyId, key);
  }
  if (!encryptionKeys.has(activeKeyId)) throw new Error('Invalid production configuration: MFA_TOTP_ACTIVE_KEY_ID.');
  const compromisedKeyIds = compromisedMfaKeyIds(environment, encryptionKeys, activeKeyId);
  const retiredKeyIds = retiredMfaKeyIds(environment, encryptionKeys, activeKeyId);
  // A key ID cannot be both operator-declared retired (fully decommissioned, an ordinary if
  // now-unused key) and compromised (actively dangerous, refused for decryption) at once -- that is
  // a contradictory declaration, not a state this codebase resolves by picking one silently.
  for (const keyId of retiredKeyIds) {
    if (compromisedKeyIds.has(keyId)) throw new Error('Invalid production configuration: MFA_TOTP_RETIRED_KEY_IDS.');
  }
  return {
    activeKeyId,
    compromisedKeyIds,
    retiredKeyIds,
    continuationKey: base64Key(environment, 'MFA_PENDING_AUTH_SIGNING_KEY'),
    encryptionKeys,
    recoveryDigestKey: base64Key(environment, 'MFA_RECOVERY_CODE_DIGEST_KEY'),
    rememberedDevice: rememberedTotpDeviceConfiguration(environment),
  };
}

export function accountDeliveryConfiguration(environment: Environment = process.env) {
  const activeVersion = required(environment, 'ACCOUNT_DELIVERY_KEY_VERSION');
  if (!/^[A-Za-z0-9_-]{1,30}$/.test(activeVersion)) throw new Error('Invalid production configuration: ACCOUNT_DELIVERY_KEY_VERSION.');
  const serialized = required(environment, 'ACCOUNT_DELIVERY_ENCRYPTION_KEYS');
  let value: unknown;
  try { value = JSON.parse(serialized); } catch { throw new Error('Invalid production configuration: ACCOUNT_DELIVERY_ENCRYPTION_KEYS.'); }
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Invalid production configuration: ACCOUNT_DELIVERY_ENCRYPTION_KEYS.');
  const keys = Object.fromEntries(Object.entries(value).map(([version, material]) => {
    if (!/^[A-Za-z0-9_-]{1,30}$/.test(version) || typeof material !== 'string' || material.length < MIN_SECRET_LENGTH) throw new Error('Invalid production configuration: ACCOUNT_DELIVERY_ENCRYPTION_KEYS.');
    return [version, material];
  }));
  if (!keys[activeVersion]) throw new Error('Invalid production configuration: ACCOUNT_DELIVERY_KEY_VERSION.');
  return { activeVersion, keys };
}

export function privilegedProductionConfiguration(environment: Environment = process.env) {
  const adminEmail = required(environment, 'IDOC_ADMIN_NOTIFICATION_EMAIL');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) throw new Error('Invalid production configuration: IDOC_ADMIN_NOTIFICATION_EMAIL.');
  return {
    accountDelivery: accountDeliveryConfiguration(environment), adminEmail,
    authSecret: authSecretForServer(environment), baseUrl: baseUrlForServer(environment),
    cronSecret: secret(environment, 'CRON_SECRET'), databaseUrl: databaseUrlForServer(environment),
    loginDeviceTrustDigestKey: loginDeviceTrustDigestKeyForServer(environment),
    mailchimpApiKey: mailchimpApiKeyForServer(environment),
    rateLimitHashKey: secret(environment, 'RATE_LIMIT_HASH_KEY'), stripeKey: stripeKeyForServer(environment),
    stripeOneTimeProductId: stripeOneTimeProductIdForServer(environment),
    stripeRecurringProductId: stripeRecurringProductIdForServer(environment),
    stripeWebhookSecret: secret(environment, 'STRIPE_WEBHOOK_SECRET'),
    turnstileSecretKey: turnstileSecretKeyForServer(environment),
  };
}
