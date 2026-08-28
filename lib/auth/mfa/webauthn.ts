import 'server-only';

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from '@simplewebauthn/server';
import type { PostgresWebAuthnStore } from './webauthn-store';
import type { WebAuthnCredentialRecord } from './types';

export const WEBAUTHN_CEREMONY_TTL_MS = 5 * 60 * 1000;
const RP_NAME = 'IDOC';

function relyingPartyOrigin(baseUrl: string): { rpID: string; expectedOrigin: string } {
  const parsed = new URL(baseUrl);
  return { rpID: parsed.hostname, expectedOrigin: parsed.origin };
}

export async function beginWebAuthnRegistration(input: {
  subjectId: string;
  applicationId: string;
  accountLabel: string;
  baseUrl: string;
  excludeCredentials: readonly WebAuthnCredentialRecord[];
  store: PostgresWebAuthnStore;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const { rpID } = relyingPartyOrigin(input.baseUrl);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: input.accountLabel,
    attestationType: 'none',
    excludeCredentials: input.excludeCredentials.map((credential) => ({
      id: credential.credentialId,
      transports: credential.transports as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
  });
  const ceremonyId = await input.store.createCeremonyChallenge({
    subjectId: input.subjectId,
    applicationId: input.applicationId,
    purpose: 'registration',
    challenge: options.challenge,
    expiresAtMs: nowMs + WEBAUTHN_CEREMONY_TTL_MS,
    nowMs,
  });
  return { ceremonyId, options };
}

export async function finishWebAuthnRegistration(input: {
  subjectId: string;
  applicationId: string;
  ceremonyId: string;
  response: RegistrationResponseJSON;
  baseUrl: string;
  deviceName: string | null;
  store: PostgresWebAuthnStore;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const expectedChallenge = await input.store.consumeCeremonyChallenge({
    ceremonyId: input.ceremonyId,
    subjectId: input.subjectId,
    applicationId: input.applicationId,
    purpose: 'registration',
    nowMs,
  });
  if (expectedChallenge === null) return { status: 'invalid-ceremony' as const };
  const { rpID, expectedOrigin } = relyingPartyOrigin(input.baseUrl);
  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge,
      expectedOrigin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch {
    return { status: 'invalid-response' as const };
  }
  if (!verification.verified) return { status: 'invalid-response' as const };
  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const created = await input.store.createCredential({
    subjectId: input.subjectId,
    applicationId: input.applicationId,
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString('base64url'),
    signCount: credential.counter,
    transports: credential.transports ?? [],
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    deviceName: input.deviceName,
    nowMs,
  });
  if (created.status !== 'created') return { status: created.status };
  return { status: 'created' as const, factorId: created.factorId };
}

export async function beginWebAuthnAuthentication(input: {
  subjectId: string;
  applicationId: string;
  baseUrl: string;
  allowCredentials: readonly WebAuthnCredentialRecord[];
  store: PostgresWebAuthnStore;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const { rpID } = relyingPartyOrigin(input.baseUrl);
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'required',
    allowCredentials: input.allowCredentials.map((credential) => ({
      id: credential.credentialId,
      transports: credential.transports as AuthenticatorTransportFuture[],
    })),
  });
  const ceremonyId = await input.store.createCeremonyChallenge({
    subjectId: input.subjectId,
    applicationId: input.applicationId,
    purpose: 'authentication',
    challenge: options.challenge,
    expiresAtMs: nowMs + WEBAUTHN_CEREMONY_TTL_MS,
    nowMs,
  });
  return { ceremonyId, options };
}

export async function finishWebAuthnAuthentication(input: {
  subjectId: string;
  applicationId: string;
  ceremonyId: string;
  response: AuthenticationResponseJSON;
  baseUrl: string;
  store: PostgresWebAuthnStore;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const expectedChallenge = await input.store.consumeCeremonyChallenge({
    ceremonyId: input.ceremonyId,
    subjectId: input.subjectId,
    applicationId: input.applicationId,
    purpose: 'authentication',
    nowMs,
  });
  if (expectedChallenge === null) return { status: 'invalid-ceremony' as const };
  const credential = await input.store.getActiveCredentialById(input.response.id, input.subjectId, input.applicationId);
  if (!credential) return { status: 'unknown-credential' as const };
  const { rpID, expectedOrigin } = relyingPartyOrigin(input.baseUrl);
  const webAuthnCredential: WebAuthnCredential = {
    id: credential.credentialId,
    publicKey: Buffer.from(credential.publicKey, 'base64url'),
    counter: credential.signCount,
    transports: credential.transports as AuthenticatorTransportFuture[],
  };
  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge,
      expectedOrigin,
      expectedRPID: rpID,
      credential: webAuthnCredential,
      requireUserVerification: true,
    });
  } catch {
    return { status: 'invalid-response' as const };
  }
  if (!verification.verified) return { status: 'invalid-response' as const };
  const accepted = await input.store.updateSignCount({
    credentialId: credential.credentialId,
    subjectId: input.subjectId,
    applicationId: input.applicationId,
    newCount: verification.authenticationInfo.newCounter,
    nowMs,
  });
  if (!accepted) return { status: 'replay' as const };
  return { status: 'verified' as const, factorId: credential.factorId };
}
