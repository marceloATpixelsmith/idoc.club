import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assertEmailLinksCanonical, EmailLinkOriginError, nonCanonicalEmailHosts } from '../lib/notifications/email-link-policy.ts';
import { EMAIL_LINK_SLOTS, emailActionUrl, emailLinkKey, emailLinkReference, parseEmailLinkReference } from '../lib/notifications/email-links.ts';

const environment = { AUTH_SECRET: 'a-test-secret-that-is-long-enough-for-hmac', BASE_URL: 'https://idoc.club/' };
const key = emailLinkKey(environment)!;

test('an identifying link round-trips and carries only a slot, a source and an id', () => {
  const reference = emailLinkReference({ id: 42, slot: 'membership', source: 'notification' }, key);
  assert.match(reference, /^membership~n42~[A-Za-z0-9_-]{22}$/);
  assert.deepEqual(parseEmailLinkReference(reference, key), { id: 42, slot: 'membership', source: 'notification' });
  assert.deepEqual(parseEmailLinkReference(emailLinkReference({ id: 7, slot: 'howto', source: 'auth_security' }, key), key), { id: 7, slot: 'howto', source: 'auth_security' });
});

test('a forged, altered, truncated or foreign-key link is rejected', () => {
  const good = emailLinkReference({ id: 42, slot: 'membership', source: 'notification' }, key);
  assert.equal(parseEmailLinkReference(good.replace('n42', 'n43'), key), null);
  assert.equal(parseEmailLinkReference(good.replace('membership', 'howto'), key), null);
  assert.equal(parseEmailLinkReference(good.slice(0, -1), key), null);
  assert.equal(parseEmailLinkReference('membership~n42~', key), null);
  assert.equal(parseEmailLinkReference('evil~n42~abc', key), null);
  assert.equal(parseEmailLinkReference('membership~n0~abc', key), null);
  assert.equal(parseEmailLinkReference('membership~n-1~abc', key), null);
  assert.equal(parseEmailLinkReference(good, emailLinkKey({ AUTH_SECRET: 'a-different-secret-that-is-long-enough' })!), null);
});

test('action buttons use the identifying link only when the notice is stored and a key exists, else the plain page', () => {
  const tracked = emailActionUrl({ environment, notificationId: 9, slot: 'membership' });
  assert.match(tracked, /^https:\/\/idoc\.club\/l\/membership~n9~[A-Za-z0-9_-]{22}$/);
  assert.equal(emailActionUrl({ environment, slot: 'membership' }), 'https://idoc.club/dashboard/membership');
  assert.equal(emailActionUrl({ environment: { BASE_URL: 'https://idoc.club' }, notificationId: 9, slot: 'membership' }), 'https://idoc.club/dashboard/membership');
  assert.equal(emailActionUrl({ environment: {}, slot: 'howto' }), `https://idoc.club${EMAIL_LINK_SLOTS.howto}`);
});

test('production refuses any email that links to a non-canonical IDOC host', () => {
  const staging = '<a href="https://staging.idoc.club/activate?token=x">go</a>';
  assert.deepEqual(nonCanonicalEmailHosts(staging), ['staging.idoc.club']);
  assert.deepEqual(nonCanonicalEmailHosts('<img src="https://redesign.idoc.club/x.png"><a href="http://localhost:3000/a">a</a><a href="https://idocclub-git-x.vercel.app/p">p</a>'), ['idocclub-git-x.vercel.app', 'localhost', 'redesign.idoc.club']);
  assert.deepEqual(nonCanonicalEmailHosts('<a href="https://idoc.club/dashboard">ok</a><a href="https://fonts.googleapis.com/css2">f</a><a href="https://www.fei.org/dressage">fei</a>'), []);
  assert.throws(() => assertEmailLinksCanonical(staging, { VERCEL_ENV: 'production' }), EmailLinkOriginError);
  assert.doesNotThrow(() => assertEmailLinksCanonical(staging, { VERCEL_ENV: 'preview' }));
  assert.doesNotThrow(() => assertEmailLinksCanonical('<a href="https://idoc.club/l/x">ok</a>', { VERCEL_ENV: 'production' }));
});

test('the send boundary applies the guard to every message, and the redirect route never takes its destination from the link', () => {
  assert.match(readFileSync('lib/notifications/brevo-transactional.ts', 'utf8'), /assertEmailLinksCanonical\(message\.html\)/);
  const route = readFileSync('app/l/[ref]/route.ts', 'utf8');
  assert.match(route, /EMAIL_LINK_SLOTS\[reference\.slot\]/);
  assert.match(route, /Referrer-Policy/);
  assert.doesNotMatch(route, /searchParams/);
  assert.match(readFileSync('lib/notifications/renewal-notices.ts', 'utf8'), /emailActionUrl\(\{ notificationId: context\.notificationId, slot: 'membership' \}\)/);
});
