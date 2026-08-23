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

test('unknown password encodings fail closed', async () => {
  assert.equal(await comparePasswords('anything', 'plaintext-or-unknown-format'), false);
  assert.equal(passwordHashNeedsUpgrade('plaintext-or-unknown-format'), true);
});
