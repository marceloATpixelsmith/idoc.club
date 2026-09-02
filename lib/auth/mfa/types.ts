export type MfaFactorStatus = 'pending' | 'active' | 'disabled' | 'revoked' | 'replaced';
export type MfaDecision = 'not-required' | 'enrollment-required' | 'challenge-required' | 'remembered-device-satisfied';
export type MfaRole = 'member' | 'admin' | 'super-admin' | 'organization-leader';
export type TotpRequirement = 'super-admin-only' | 'privileged-users' | 'all-users';
export type MfaChallengePurpose = 'login' | 'password-reset' | 'step-up';
export type SensitiveAction =
  | 'change-email'
  | 'change-password'
  | 'change-mfa'
  | 'replace-authenticator'
  | 'generate-recovery-codes'
  | 'invite-privileged-user'
  | 'change-privileged-permissions'
  | 'change-security-settings'
  | 'force-revoke-authority';

export interface TotpFactorRecord {
  factorId: string;
  subjectId: string;
  applicationId: string;
  status: MfaFactorStatus;
  encryptedSecret: string;
  keyId: string;
  createdAtMs: number;
  activatedAtMs: number | null;
  replacedByFactorId: string | null;
  lastAcceptedCounter: number | null;
}

export interface TotpEnrollmentRecord {
  transactionId: string;
  subjectId: string;
  applicationId: string;
  factorId: string;
  purpose: 'mfa-enrollment' | 'authenticator-replacement' | 'mfa-recovery';
  createdAtMs: number;
  expiresAtMs: number;
  consumedAtMs: number | null;
}

export interface RecoveryCodeRecord {
  recoveryCodeId: string;
  subjectId: string;
  applicationId: string;
  digest: string;
  createdAtMs: number;
  consumedAtMs: number | null;
  generationId: string;
}

export interface RememberedDeviceRecord {
  rememberedDeviceId: string;
  subjectId: string;
  applicationId: string;
  tokenDigest: string;
  issuedAtMs: number;
  expiresAtMs: number;
  revokedAtMs: number | null;
  factorId: string;
}

export type WebAuthnCeremonyPurpose = 'registration' | 'authentication';
export type WebAuthnCredentialDeviceType = 'singleDevice' | 'multiDevice';

export interface WebAuthnCredentialRecord {
  credentialId: string;
  factorId: string;
  subjectId: string;
  applicationId: string;
  publicKey: string;
  signCount: number;
  transports: readonly string[];
  deviceType: WebAuthnCredentialDeviceType;
  backedUp: boolean;
  deviceName: string | null;
  status: MfaFactorStatus;
  createdAtMs: number;
  lastUsedAtMs: number | null;
}

export interface MfaStore {
  createPendingTotp(input: { factor: TotpFactorRecord; enrollment: TotpEnrollmentRecord }): Promise<void>;
  getPendingTotpEnrollment(input: {
    transactionId: string;
    subjectId: string;
    applicationId: string;
    factorId: string;
    nowMs: number;
  }): Promise<{ factor: TotpFactorRecord; enrollment: TotpEnrollmentRecord } | null>;
  consumeEnrollmentAndActivate(input: { transactionId: string; subjectId: string; applicationId: string; factorId: string; acceptedCounter: number; nowMs: number }): Promise<'activated' | 'invalid-transaction' | 'replay'>;
  getActiveTotp(subjectId: string, applicationId: string): Promise<TotpFactorRecord | null>;
  acceptTotpChallenge(input: {
    transactionId: string;
    purpose: MfaChallengePurpose;
    factorId: string;
    subjectId: string;
    applicationId: string;
    counter: number;
    nowMs: number;
  }): Promise<'accepted' | 'replay' | 'inactive' | 'invalid-transaction' | 'attempts-exhausted'>;
  recordChallengeFailure(input: {
    transactionId: string;
    subjectId: string;
    applicationId: string;
    purpose: MfaChallengePurpose;
    nowMs: number;
  }): Promise<'recorded' | 'invalid-transaction' | 'attempts-exhausted'>;
  replaceRecoveryCodes(input: { subjectId: string; applicationId: string; generationId: string; codes: readonly RecoveryCodeRecord[]; nowMs: number }): Promise<void>;
  consumeRecoveryCode(input: { subjectId: string; applicationId: string; digests: readonly string[]; nowMs: number }): Promise<'consumed' | 'invalid'>;
  createRememberedDevice(record: RememberedDeviceRecord): Promise<void>;
  consumeRememberedDevice(input: { subjectId: string; applicationId: string; tokenDigest: string; nowMs: number }): Promise<'valid' | 'invalid'>;
  revokeRememberedDevices(subjectId: string, applicationId: string, nowMs: number): Promise<void>;
  createChallenge(input: { transactionId: string; subjectId: string; applicationId: string; purpose: MfaChallengePurpose; expiresAtMs: number; maxAttempts: number; nowMs: number }): Promise<void>;
}
