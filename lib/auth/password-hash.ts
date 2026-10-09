import 'server-only';

import * as crypto from 'node:crypto';
import { compare as compareBcrypt } from 'bcryptjs';

const ARGON2_PREFIX = 'argon2id$v=19';
const ARGON2_MEMORY_KIB = 65_536;
const ARGON2_PASSES = 3;
const ARGON2_PARALLELISM = 1;
const ARGON2_TAG_LENGTH = 32;
const ARGON2_SALT_LENGTH = 16;

type Argon2Parameters = {
  memory: number;
  message: string;
  nonce: Buffer;
  parallelism: number;
  passes: number;
  tagLength: number;
};

type Argon2Function = (
  algorithm: 'argon2id',
  parameters: Argon2Parameters,
  callback: (error: Error | null, derivedKey: Buffer) => void
) => void;

function argon2Function(): Argon2Function {
  const candidate = (crypto as unknown as { argon2?: Argon2Function }).argon2;
  if (typeof candidate !== 'function') {
    throw new Error('Argon2id is unavailable in this Node.js runtime. Node 24.7.0 or newer is required.');
  }
  return candidate;
}

function deriveArgon2id(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    argon2Function()('argon2id', {
      memory: ARGON2_MEMORY_KIB,
      message: password,
      nonce: salt,
      parallelism: ARGON2_PARALLELISM,
      passes: ARGON2_PASSES,
      tagLength: ARGON2_TAG_LENGTH,
    }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

function encodedParameters() {
  return `m=${ARGON2_MEMORY_KIB},t=${ARGON2_PASSES},p=${ARGON2_PARALLELISM}`;
}

function parseArgon2id(storedHash: string) {
  const parts = storedHash.split('$');
  if (parts.length !== 5 || parts[0] !== 'argon2id' || parts[1] !== 'v=19') return null;
  if (parts[2] !== encodedParameters()) return null;
  try {
    const salt = Buffer.from(parts[3], 'base64url');
    const hash = Buffer.from(parts[4], 'base64url');
    if (salt.length !== ARGON2_SALT_LENGTH || hash.length !== ARGON2_TAG_LENGTH) return null;
    return { hash, salt };
  } catch {
    return null;
  }
}

/** New credentials use a versioned Argon2id representation. Existing bcrypt credentials remain
 * verifiable and are upgraded after successful authentication rather than invalidated in bulk. */
export async function hashPassword(password: string) {
  const salt = crypto.randomBytes(ARGON2_SALT_LENGTH);
  const hash = await deriveArgon2id(password, salt);
  return `${ARGON2_PREFIX}$${encodedParameters()}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function comparePasswords(plainTextPassword: string, storedHash: string) {
  const parsed = parseArgon2id(storedHash);
  if (parsed) {
    const candidate = await deriveArgon2id(plainTextPassword, parsed.salt);
    return candidate.length === parsed.hash.length && crypto.timingSafeEqual(candidate, parsed.hash);
  }

  // Compatibility boundary for credentials created before the canonical Argon2id retrofit.
  if (/^\$2[aby]\$/.test(storedHash)) return compareBcrypt(plainTextPassword, storedHash);
  return false;
}

export function passwordHashNeedsUpgrade(storedHash: string) {
  return parseArgon2id(storedHash) === null;
}
