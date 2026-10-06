import 'server-only';

import * as crypto from 'node:crypto';
import { compare as compareBcrypt } from 'bcryptjs';

const ARGON2_PREFIX = 'argon2id$v=19';
const ARGON2_MEMORY_KIB = 65_536;
const ARGON2_PASSES = 3;
const ARGON2_PARALLELISM = 1;
const ARGON2_TAG_LENGTH = 32;
const ARGON2_SALT_LENGTH = 16;
const WP_PORTABLE_ALPHABET = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function encodePortable(input: Buffer, count: number) {
  let output = '';
  let index = 0;
  do {
    let value = input[index++];
    output += WP_PORTABLE_ALPHABET[value & 0x3f];
    if (index < count) value |= input[index] << 8;
    output += WP_PORTABLE_ALPHABET[(value >> 6) & 0x3f];
    if (index++ >= count) break;
    if (index < count) value |= input[index] << 16;
    output += WP_PORTABLE_ALPHABET[(value >> 12) & 0x3f];
    if (index++ >= count) break;
    output += WP_PORTABLE_ALPHABET[(value >> 18) & 0x3f];
  } while (index < count);
  return output;
}

/** WordPress portable phpass ($P$/$H$) verifier. Invalid cost/salt/length values fail closed
 * before any expensive loop. The comparison covers the complete stored representation. */
function compareWordPressPortable(password: string, storedHash: string) {
  if (!/^\$[PH]\$[./0-9A-Za-z]{31}$/.test(storedHash)) return false;
  const countLog2 = WP_PORTABLE_ALPHABET.indexOf(storedHash[3]);
  // WordPress production phpass uses a bounded work factor (normally 8/13). Refuse attacker-
  // supplied excessive costs rather than turning a login request into billions of MD5 rounds.
  if (countLog2 < 7 || countLog2 > 20) return false;
  const salt = storedHash.slice(4, 12);
  let digest = crypto.createHash('md5').update(salt, 'binary').update(password, 'utf8').digest();
  for (let count = 1 << countLog2; count > 0; count -= 1) {
    digest = crypto.createHash('md5').update(digest).update(password, 'utf8').digest();
  }
  const candidate = `${storedHash.slice(0, 12)}${encodePortable(digest, 16)}`;
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(storedHash));
}

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
  if (/^\$[PH]\$/.test(storedHash)) return compareWordPressPortable(plainTextPassword, storedHash);
  // WordPress 6.8+ bcrypt hashes pre-hash the UTF-8 password with SHA-384/base64. WordPress uses
  // the `$wp` marker specifically so these cannot be confused with ordinary bcrypt credentials.
  if (/^\$wp\$2y\$/.test(storedHash)) {
    const digest = crypto.createHmac('sha384', 'wp-sha384')
      .update(plainTextPassword.trim(), 'utf8')
      .digest('base64');
    return compareBcrypt(digest, storedHash.slice(3));
  }
  return false;
}

export function passwordHashNeedsUpgrade(storedHash: string) {
  return parseArgon2id(storedHash) === null;
}
