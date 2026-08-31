import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { parseMandrillEvents, verifyMandrillSignature } from '../lib/notifications/mailchimp-transactional-webhook.ts';

const url = 'https://idoc.club/api/mailchimp/webhook';
const webhookKey = 'test-webhook-key';

function sign(entries: [string, string][], key = webhookKey) {
  let signedString = url;
  for (const [k, v] of entries) signedString += k + v;
  return createHmac('sha1', key).update(signedString, 'utf8').digest('base64');
}

test('verifyMandrillSignature accepts a correctly computed signature and rejects a tampered one', () => {
  const entries: [string, string][] = [['mandrill_events', '[{"event":"hard_bounce"}]']];
  const signature = sign(entries);
  assert.equal(verifyMandrillSignature(url, entries, signature, webhookKey), true);
  assert.equal(verifyMandrillSignature(url, [['mandrill_events', '[{"event":"spam"}]']], signature, webhookKey), false);
  assert.equal(verifyMandrillSignature(url, entries, sign(entries, 'wrong-key'), webhookKey), false);
  assert.equal(verifyMandrillSignature(url + '-tampered', entries, signature, webhookKey), false);
});

test('verifyMandrillSignature rejects when the key or header is missing, without throwing', () => {
  const entries: [string, string][] = [['mandrill_events', '[]']];
  assert.equal(verifyMandrillSignature(url, entries, sign(entries), undefined), false);
  assert.equal(verifyMandrillSignature(url, entries, null, webhookKey), false);
});

test('parseMandrillEvents accepts a well-formed batch and reads only categorical fields', () => {
  const raw = JSON.stringify([
    { event: 'hard_bounce', msg: { bounce_description: 'bad_mailbox', diag: 'raw smtp 550 detail', email: 'bounced@example.test' } },
    { event: 'spam', msg: { email: 'complainer@example.test' } },
    { event: 'send', msg: { email: 'delivered@example.test' } },
  ]);
  const events = parseMandrillEvents(raw);
  assert.equal(events?.length, 3);
  assert.deepEqual(events?.[0], { event: 'hard_bounce', msg: { bounce_description: 'bad_mailbox', email: 'bounced@example.test' } });
  assert.equal((events?.[0].msg as Record<string, unknown>).diag, undefined);
  assert.deepEqual(events?.[1], { event: 'spam', msg: { bounce_description: undefined, email: 'complainer@example.test' } });
});

test('parseMandrillEvents rejects malformed, non-array, or missing payloads distinctly from an empty batch', () => {
  assert.equal(parseMandrillEvents(undefined), null);
  assert.equal(parseMandrillEvents('not json'), null);
  assert.equal(parseMandrillEvents('{"event":"hard_bounce"}'), null);
  assert.equal(parseMandrillEvents('[{"no_event_field":true}]'), null);
  assert.deepEqual(parseMandrillEvents('[]'), []);
});
