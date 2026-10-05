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

test('a WordPress 6.8 bcrypt fixture verifies using its trimmed HMAC-SHA384 pre-hash', async () => {
  // WordPress-format test vector: hashpwn -> $wp + PHP bcrypt(HMAC-SHA384(trim(password), "wp-sha384")).
  const legacy = '$wp$2y$10$607XKVrBjPEqujeOXNwbYuOJ.gPMd2TelMMknmeV70Kap1E81Ovo6';
  assert.equal(await comparePasswords('hashpwn', legacy), true);
  assert.equal(await comparePasswords(' hashpwn ', legacy), true);
  assert.equal(await comparePasswords('wrong password', legacy), false);
  assert.equal(passwordHashNeedsUpgrade(legacy), true);
});

test('unknown password encodings fail closed', async () => {
  assert.equal(await comparePasswords('anything', 'plaintext-or-unknown-format'), false);
  assert.equal(passwordHashNeedsUpgrade('plaintext-or-unknown-format'), true);
});
