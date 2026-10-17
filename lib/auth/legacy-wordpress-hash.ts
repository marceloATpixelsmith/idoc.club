import { createHash, createHmac } from 'node:crypto';
import { compare as compareBcrypt } from 'bcryptjs';

/**
 * Verifiers for the two WordPress password-hash formats found in the legacy export (docs/03 section 11):
 *  - portable phpass (`$P$...`, also `$H$...`): iterated MD5, as in WordPress's PasswordHash class;
 *  - WordPress bcrypt (`$wp$2y$...`, WordPress 6.8+): bcrypt over base64(HMAC-SHA384(password, "wp-sha384")), stored with a `$wp` prefix.
 * Verification only. Nothing here ever creates a legacy-format hash.
 *
 * TEMPORARY legacy-import support code: delete once every migrated member has signed in or reset their password.
 */
/** WordPress refuses passwords longer than this when hashing and checking. */
const MAX_PASSWORD_LENGTH = 4096;
const ITOA64 = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function encode64(input: Buffer, count: number): string {
  let output = '';
  let i = 0;
  do {
    let value = input[i++];
    output += ITOA64[value & 0x3f];
    if (i < count) value |= input[i] << 8;
    output += ITOA64[(value >> 6) & 0x3f];
    if (i++ >= count) break;
    if (i < count) value |= input[i] << 16;
    output += ITOA64[(value >> 12) & 0x3f];
    if (i++ >= count) break;
    output += ITOA64[(value >> 18) & 0x3f];
  } while (i < count);
  return output;
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && createHash('sha256').update(left).digest().equals(createHash('sha256').update(right).digest());
}

export function verifyPhpassPortable(password: string, storedHash: string): boolean {
  if (password.length > MAX_PASSWORD_LENGTH || storedHash.length !== 34 || !(storedHash.startsWith('$P$') || storedHash.startsWith('$H$'))) return false;
  const countLog2 = ITOA64.indexOf(storedHash[3]);
  if (countLog2 < 7 || countLog2 > 30) return false;
  const salt = storedHash.slice(4, 12);
  if (salt.length !== 8) return false;
  const plain = Buffer.from(password, 'utf8');
  let hash = createHash('md5').update(salt).update(plain).digest();
  for (let rounds = 2 ** countLog2; rounds > 0; rounds -= 1) hash = createHash('md5').update(hash).update(plain).digest();
  return constantTimeEqual(storedHash.slice(0, 12) + encode64(hash, 16), storedHash);
}

export async function verifyWordPressBcrypt(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash.startsWith('$wp$2') || password.length > MAX_PASSWORD_LENGTH) return false;
  const prehash = createHmac('sha384', 'wp-sha384').update(password, 'utf8').digest('base64');
  // WordPress compares the exact string supplied; no trimming or other retry, so a different password can never match.
  return compareBcrypt(prehash, storedHash.slice(3));
}

export type LegacyPasswordFormat = 'phpass' | 'wp_bcrypt';

/** Verifies `password` against an exported WordPress hash of the stated format. Unknown formats never verify. */
export async function verifyLegacyPassword(password: string, storedHash: string, format: string): Promise<boolean> {
  if (format === 'phpass') return verifyPhpassPortable(password, storedHash);
  if (format === 'wp_bcrypt') return verifyWordPressBcrypt(password, storedHash);
  return false;
}
