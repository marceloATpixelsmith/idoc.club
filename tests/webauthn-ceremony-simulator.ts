import { webcrypto } from 'node:crypto';
import { cose, isoBase64URL, isoCBOR, toHash } from '@simplewebauthn/server/helpers';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';

// AUTH-CRYPTO-003 / AUTH-OPERATIONS-004: a real, minimal WebAuthn authenticator simulator. It
// generates a genuine ES256 (P-256) keypair via Node's own WebCrypto implementation and produces
// real, byte-correct attestationObject/authenticatorData/clientDataJSON/signature material that the
// actual production verifyRegistrationResponse/verifyAuthenticationResponse
// (lib/auth/mfa/webauthn.ts) accepts -- not a mocked verifier, not a stubbed response. This
// deliberately reuses @simplewebauthn/server's own public `/helpers` subpath export (isoCBOR,
// isoBase64URL, the COSE constants, toHash) so the CBOR and base64url encoding this simulator
// produces is guaranteed byte-compatible with what the real verifier decodes, rather than an
// independently-fallible hand-rolled reimplementation of either format.

const AAGUID = new Uint8Array(16); // an all-zero AAGUID is a valid "unregistered authenticator model" value per the WebAuthn spec.

function uint16be(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, false);
  return bytes;
}

function uint32be(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

// TypeScript's typed-array generics (Uint8Array<ArrayBuffer> vs. the looser
// Uint8Array<ArrayBufferLike> that WebCrypto/CBOR helper return types carry) are a compile-time
// distinction only -- both wrap the exact same bytes at runtime. This cast is the single, explicit
// crossing point between the two, rather than scattering unchecked `as` casts throughout the file.
function strict(value: Uint8Array): Uint8Array<ArrayBuffer> {
  return value as Uint8Array<ArrayBuffer>;
}

function derInteger(bytes: Uint8Array): Uint8Array {
  let trimmed = bytes;
  while (trimmed.length > 1 && trimmed[0] === 0 && (trimmed[1] & 0x80) === 0) trimmed = trimmed.subarray(1);
  const needsLeadingZero = (trimmed[0] & 0x80) === 0x80;
  const value = needsLeadingZero ? Uint8Array.from([0, ...trimmed]) : trimmed;
  return Uint8Array.from([0x02, value.length, ...value]);
}

/** WebCrypto's ECDSA sign/verify operate on the raw, fixed-length IEEE P1363 `r || s` signature
 * format -- but WebAuthn signatures are ASN.1 DER-encoded (SEQUENCE of two INTEGERs), per
 * @simplewebauthn/server's own unwrapEC2Signature (which DER-decodes every incoming signature
 * before handing it to WebCrypto for verification). This is the one asymmetry WebCrypto's raw
 * sign/verify pair doesn't hide: the raw bytes this simulator signs with must be DER-wrapped before
 * they reach the real verifier, exactly as a real browser's authenticator implementation would
 * already do internally. componentLength is 32 for P-256 (this simulator's only supported curve). */
function derEncodeEcdsaSignature(raw: Uint8Array, componentLength = 32): Uint8Array {
  const r = derInteger(raw.slice(0, componentLength));
  const s = derInteger(raw.slice(componentLength));
  return Uint8Array.from([0x30, r.length + s.length, ...r, ...s]);
}

export class TestWebAuthnAuthenticator {
  readonly credentialId: Uint8Array;

  private constructor(private readonly keyPair: CryptoKeyPair, credentialId?: Uint8Array) {
    this.credentialId = credentialId ?? webcrypto.getRandomValues(new Uint8Array(32));
  }

  static async create(credentialId?: Uint8Array): Promise<TestWebAuthnAuthenticator> {
    const keyPair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    return new TestWebAuthnAuthenticator(keyPair, credentialId);
  }

  /** The COSE_Key CBOR bytes for this authenticator's public key -- the exact format
   * lib.mfa.webauthn-store.ts persists in idoc.webauthn_credentials.public_key. Exposed so tests can
   * seed a credential row directly (bypassing a full registration ceremony) when only the
   * authentication half is under test. */
  async coseBytesPublicKey(): Promise<Uint8Array> {
    const raw = new Uint8Array(await webcrypto.subtle.exportKey('raw', this.keyPair.publicKey));
    // Uncompressed EC point per SEC1: 0x04 || X(32 bytes) || Y(32 bytes).
    const x = raw.slice(1, 33);
    const y = raw.slice(33, 65);
    const coseKey = new Map<number, unknown>([
      [cose.COSEKEYS.kty, cose.COSEKTY.EC2],
      [cose.COSEKEYS.alg, cose.COSEALG.ES256],
      [cose.COSEKEYS.crv, cose.COSECRV.P256],
      [cose.COSEKEYS.x, strict(x)],
      [cose.COSEKEYS.y, strict(y)],
    ]);
    return strict(isoCBOR.encode(coseKey as Parameters<typeof isoCBOR.encode>[0]));
  }

  private async buildAuthenticatorData(rpID: string, options: { includeAttestedCredentialData: boolean; signCount: number; userVerified?: boolean }): Promise<Uint8Array<ArrayBuffer>> {
    const rpIdHash = strict(new Uint8Array(await toHash(rpID)));
    // Flag bits per the WebAuthn spec: UP (0x01) user presence, UV (0x04) user verification, AT
    // (0x40) attested credential data present (registration ceremonies only).
    const flags = 0x01 | (options.userVerified === false ? 0 : 0x04) | (options.includeAttestedCredentialData ? 0x40 : 0);
    const base = concatBytes(rpIdHash, new Uint8Array([flags]), uint32be(options.signCount));
    if (!options.includeAttestedCredentialData) return base;
    const publicKeyBytes = await this.coseBytesPublicKey();
    return concatBytes(base, AAGUID, uint16be(this.credentialId.length), this.credentialId, publicKeyBytes);
  }

  private buildClientDataJSON(type: 'webauthn.create' | 'webauthn.get', challenge: string, origin: string): Uint8Array<ArrayBuffer> {
    const json = JSON.stringify({ challenge, crossOrigin: false, origin, type });
    return strict(new TextEncoder().encode(json));
  }

  /** A real, verifiable "none"-attestation registration response for `challenge`/`rpID`/`origin` --
   * the exact shape lib/auth/mfa/webauthn.ts's finishWebAuthnRegistration passes straight into
   * @simplewebauthn/server's real verifyRegistrationResponse. */
  async buildRegistrationResponse(input: { challenge: string; rpID: string; origin: string }): Promise<RegistrationResponseJSON> {
    const clientDataJSON = this.buildClientDataJSON('webauthn.create', input.challenge, input.origin);
    const authData = await this.buildAuthenticatorData(input.rpID, { includeAttestedCredentialData: true, signCount: 0 });
    const attestationObject = strict(isoCBOR.encode(new Map<string, unknown>([
      ['fmt', 'none'],
      ['attStmt', new Map()],
      ['authData', authData],
    ]) as Parameters<typeof isoCBOR.encode>[0]));
    return {
      clientExtensionResults: {},
      id: isoBase64URL.fromBuffer(strict(this.credentialId)),
      rawId: isoBase64URL.fromBuffer(strict(this.credentialId)),
      response: {
        attestationObject: isoBase64URL.fromBuffer(attestationObject),
        clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
        transports: ['internal'],
      },
      type: 'public-key',
    };
  }

  /** A real, verifiably-signed authentication response for `challenge`/`rpID`/`origin` at the given
   * `signCount` -- the exact shape lib/auth/mfa/webauthn.ts's finishWebAuthnAuthentication passes
   * straight into @simplewebauthn/server's real verifyAuthenticationResponse. Calling this twice
   * with the same `signCount` produces two independently-valid-looking but distinct signed
   * assertions (fresh clientDataJSON/signature each time) -- the real production replay defense
   * (lib/auth/mfa/webauthn-store.ts's updateSignCount rejecting a non-increasing counter) is what
   * must catch the second one, not any difference this simulator introduces. */
  async buildAuthenticationResponse(input: { challenge: string; rpID: string; origin: string; signCount: number; userVerified?: boolean }): Promise<AuthenticationResponseJSON> {
    const clientDataJSON = this.buildClientDataJSON('webauthn.get', input.challenge, input.origin);
    const authenticatorData = await this.buildAuthenticatorData(input.rpID, { includeAttestedCredentialData: false, signCount: input.signCount, userVerified: input.userVerified });
    const clientDataHash = strict(new Uint8Array(await toHash(clientDataJSON)));
    const signedData = concatBytes(authenticatorData, clientDataHash);
    const rawSignature = new Uint8Array(await webcrypto.subtle.sign({ hash: 'SHA-256', name: 'ECDSA' }, this.keyPair.privateKey, signedData));
    const signature = strict(derEncodeEcdsaSignature(rawSignature));
    return {
      clientExtensionResults: {},
      id: isoBase64URL.fromBuffer(strict(this.credentialId)),
      rawId: isoBase64URL.fromBuffer(strict(this.credentialId)),
      response: {
        authenticatorData: isoBase64URL.fromBuffer(authenticatorData),
        clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
        signature: isoBase64URL.fromBuffer(signature),
      },
      type: 'public-key',
    };
  }
}
