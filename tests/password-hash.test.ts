import assert from 'node:assert/strict';
import test from 'node:test';
import { hash as hashBcrypt } from 'bcryptjs';
import { comparePasswords, hashPassword, passwordHashNeedsUpgrade } from '../lib/auth/password-hash.ts';

test('new passwords use versioned Argon2id and verify without upgrade', async () => {
  const encoded = await hashPassword('correct horse battery staple');
  assert.match(encoded, /^argon2id\$v=19\$m=65536,t=3,p=1\$/);
  assert.equal(await comparePasswords('correct horse battery staple', encoded), true);
  assert.equal(await comparePasswords('wrong password', encoded), false);
  assert.equal(passwordHashNeedsUpgrade(encoded), false);
});

test('existing bcrypt credentials remain valid and are marked for upgrade', async () => {
  const legacy = await hashBcrypt('Legacy password 123!', 10);
  assert.equal(await comparePasswords('Legacy password 123!', legacy), true);
  assert.equal(await comparePasswords('wrong password', legacy), false);
  assert.equal(passwordHashNeedsUpgrade(legacy), true);
});

test('supported WordPress portable phpass credentials verify exactly and malformed variants fail closed', async () => {
  // Synthetic phpass fixture (iteration character B, salt 12345678); no migrated digest or PII.
  const legacy = '$P$B12345678GppRRE88B/Ii0Uac.D10U/';
  assert.equal(await comparePasswords('Synthetic legacy 42!', legacy), true);
  assert.equal(await comparePasswords('wrong password', legacy), false);
  assert.equal(await comparePasswords('Synthetic legacy 42!', `${legacy}x`), false);
  assert.equal(await comparePasswords('Synthetic legacy 42!', '$P$z12345678L6aeK5TI9PSVRcT4exZCc0'), false);
  assert.equal(passwordHashNeedsUpgrade(legacy), true);
});

test('WordPress 6.8 bcrypt credentials use the required SHA-384 pre-hash', async () => {
  const password = 'Synthetic WordPress 68!';
  const { createHash } = await import('node:crypto');
  const prehash = createHash('sha384').update(password, 'utf8').digest('base64');
  const bcrypt = await hashBcrypt(prehash, 10);
  const legacy = `$wp${bcrypt.replace('$2b$', '$2y$')}`;
  assert.equal(await comparePasswords(password, legacy), true);
  assert.equal(await comparePasswords(`${password}x`, legacy), false);
  assert.equal(passwordHashNeedsUpgrade(legacy), true);
});

test('unknown password encodings fail closed', async () => {
  assert.equal(await comparePasswords('anything', 'plaintext-or-unknown-format'), false);
  assert.equal(passwordHashNeedsUpgrade('plaintext-or-unknown-format'), true);
});
