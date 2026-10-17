import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { hash as hashBcrypt } from 'bcryptjs';
import { verifyLegacyPassword, verifyPhpassPortable, verifyWordPressBcrypt } from '../lib/auth/legacy-wordpress-hash.ts';

// Published phpass test vector (phpass 0.5 documentation): password "test12345".
const PHPASS = '$P$9IQRaTwmfeRo7ud9Fh4E2PdI0S3r.L0';

test('phpass portable hashes verify only the right password', () => {
  assert.equal(verifyPhpassPortable('test12345', PHPASS), true);
  assert.equal(verifyPhpassPortable('test12346', PHPASS), false);
  assert.equal(verifyPhpassPortable('', PHPASS), false);
  assert.equal(verifyPhpassPortable('test12345', PHPASS.replace('$P$', '$H$')), true);
});

test('malformed phpass hashes never verify', () => {
  for (const bad of ['', '$P$', PHPASS.slice(0, 33), `${PHPASS}x`, `$P$!${PHPASS.slice(4)}`, '$P$0IQRaTwmfeRo7ud9Fh4E2PdI0S3r.L0']) {
    assert.equal(verifyPhpassPortable('test12345', bad), false);
  }
});

test('WordPress bcrypt hashes use the HMAC-SHA384 prehash and the $wp prefix', async () => {
  const prehash = (value: string) => createHmac('sha384', 'wp-sha384').update(value, 'utf8').digest('base64');
  const stored = `$wp${await hashBcrypt(prehash('Correct horse 42!'), 4)}`.replace(/^\$wp\$2[ab]\$/, '$wp$2y$');
  assert.match(stored, /^\$wp\$2y\$04\$/);
  assert.equal(await verifyWordPressBcrypt('Correct horse 42!', stored), true);
  assert.equal(await verifyWordPressBcrypt('Correct horse 43!', stored), false);
  // Exact comparison only: surrounding whitespace is a different password.
  assert.equal(await verifyWordPressBcrypt(' Correct horse 42! ', stored), false);
  assert.equal(await verifyWordPressBcrypt('x'.repeat(4097), stored), false);
  // A plain bcrypt hash of the raw password (no prehash, no prefix) is not a WordPress bcrypt hash.
  assert.equal(await verifyWordPressBcrypt('Correct horse 42!', await hashBcrypt('Correct horse 42!', 4)), false);
});

test('the format column selects the verifier and unknown formats never verify', async () => {
  assert.equal(await verifyLegacyPassword('test12345', PHPASS, 'phpass'), true);
  assert.equal(await verifyLegacyPassword('test12345', PHPASS, 'wp_bcrypt'), false);
  assert.equal(await verifyLegacyPassword('test12345', PHPASS, 'md5'), false);
});
