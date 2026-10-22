import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

type Call = { body?: Record<string, unknown>; method: string; url: string };

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
let calls: Call[] = [];

function stubMailchimp(respond: (call: Call) => Response) {
  calls = [];
  globalThis.fetch = async (input, init) => {
    const call: Call = {
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      method: String(init?.method),
      url: String(input),
    };
    calls.push(call);
    return respond(call);
  };
}

const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' }, status });

beforeEach(() => {
  process.env.MAILCHIMP_MARKETING_API_KEY = 'test-api-key';
  process.env.MAILCHIMP_MARKETING_AUDIENCE_ID = 'audience';
  process.env.MAILCHIMP_MARKETING_SERVER_PREFIX = 'us1';
  process.env.DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING = 'false';
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

test('opt-in adds a member Mailchimp has never seen as subscribed', async () => {
  stubMailchimp((call) => call.method === 'GET' ? json({}, 404) : json({ status: 'subscribed' }));
  const { requestMarketingOptIn } = await import('../lib/notifications/mailchimp-marketing.ts');
  assert.equal(await requestMarketingOptIn(' MEMBER@Example.Test '), 'subscribed');
  const put = calls.find(({ method }) => method === 'PUT');
  assert.deepEqual(put?.body, { email_address: 'member@example.test', status: 'subscribed', status_if_new: 'subscribed' });
  assert.match(String(put?.url), /\/lists\/audience\/members\/[0-9a-f]{32}$/);
});

test('opt-in sends a confirmation email (pending) to a member who unsubscribed themselves', async () => {
  stubMailchimp((call) => call.method === 'GET' ? json({ status: 'unsubscribed' }) : json({ status: 'pending' }));
  const { requestMarketingOptIn } = await import('../lib/notifications/mailchimp-marketing.ts');
  assert.equal(await requestMarketingOptIn('member@example.test'), 'pending');
  const puts = calls.filter(({ method }) => method === 'PUT');
  assert.equal(puts.length, 1);
  assert.deepEqual(puts[0].body, { email_address: 'member@example.test', status: 'pending' });
});

test('opt-in falls back to pending when Mailchimp rejects subscribed for a compliance-state member', async () => {
  stubMailchimp((call) => {
    if (call.method === 'GET') return json({ status: 'archived' });
    return call.body?.status === 'subscribed' ? json({ title: 'Member In Compliance State' }, 400) : json({ status: 'pending' });
  });
  const { requestMarketingOptIn } = await import('../lib/notifications/mailchimp-marketing.ts');
  assert.equal(await requestMarketingOptIn('member@example.test'), 'pending');
  assert.deepEqual(calls.filter(({ method }) => method === 'PUT').map(({ body }) => body?.status), ['subscribed', 'pending']);
});

test('opt-in changes nothing for members already subscribed, pending, or cleaned', async () => {
  for (const status of ['subscribed', 'pending', 'cleaned'] as const) {
    stubMailchimp(() => json({ status }));
    const { requestMarketingOptIn } = await import('../lib/notifications/mailchimp-marketing.ts');
    assert.equal(await requestMarketingOptIn('member@example.test'), status);
    assert.deepEqual(calls.map(({ method }) => method), ['GET']);
  }
});

test('opt-in reports failure and never throws on provider errors', async () => {
  stubMailchimp((call) => call.method === 'GET' ? json({}, 500) : json({}));
  const { requestMarketingOptIn } = await import('../lib/notifications/mailchimp-marketing.ts');
  assert.equal(await requestMarketingOptIn('member@example.test'), 'failed');
  globalThis.fetch = async () => { throw new Error('network down'); };
  assert.equal(await requestMarketingOptIn('member@example.test'), 'failed');
});

test('marketing calls are held by the launch hold and skipped when unconfigured', async () => {
  stubMailchimp(() => json({ status: 'subscribed' }));
  const { requestMarketingOptIn, requestMarketingOptOut, unsubscribeFromMarketingAudience } = await import('../lib/notifications/mailchimp-marketing.ts');
  process.env.DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING = 'true';
  assert.equal(await requestMarketingOptIn('member@example.test'), 'blocked');
  assert.equal(await requestMarketingOptOut('member@example.test'), 'blocked');
  assert.deepEqual(await unsubscribeFromMarketingAudience('member@example.test'), { status: 'blocked' });
  assert.equal(calls.length, 0);
  process.env.DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING = 'false';
  delete process.env.MAILCHIMP_MARKETING_API_KEY;
  assert.equal(await requestMarketingOptIn('member@example.test'), 'unavailable');
  assert.equal(await requestMarketingOptOut('member@example.test'), 'unavailable');
  assert.equal(calls.length, 0);
});

test('opt-out patches only status, never creating an unsubscribed record', async () => {
  stubMailchimp(() => json({ status: 'unsubscribed' }));
  const { requestMarketingOptOut } = await import('../lib/notifications/mailchimp-marketing.ts');
  assert.equal(await requestMarketingOptOut('member@example.test'), 'unsubscribed');
  assert.deepEqual(calls[0].body, { status: 'unsubscribed' });
  assert.equal(calls[0].method, 'PATCH');
  stubMailchimp(() => json({}, 404));
  assert.equal(await requestMarketingOptOut('member@example.test'), 'not_found');
  stubMailchimp(() => json({}, 500));
  assert.equal(await requestMarketingOptOut('member@example.test'), 'failed');
});

test('listing pages through every member in a status and normalizes addresses', async () => {
  const page = (count: number, prefix: string) => ({ members: Array.from({ length: count }, (_, index) => ({ email_address: `${prefix}${index}@Example.Test` })) });
  stubMailchimp((call) => json(new URL(call.url).searchParams.get('offset') === '0' ? page(500, 'a') : page(2, 'b')));
  const { listMarketingMembersByStatus } = await import('../lib/notifications/mailchimp-marketing.ts');
  const members = await listMarketingMembersByStatus('unsubscribed');
  assert.equal(members.length, 502);
  assert.equal(members[0].email, 'a0@example.test');
  assert.equal(new URL(calls[0].url).searchParams.get('status'), 'unsubscribed');
  assert.equal(calls.length, 2);
});

test('listing throws instead of returning a partial list when Mailchimp errors or is unconfigured', async () => {
  const { listMarketingMembersByStatus } = await import('../lib/notifications/mailchimp-marketing.ts');
  stubMailchimp(() => json({}, 500));
  await assert.rejects(listMarketingMembersByStatus('cleaned'));
  delete process.env.MAILCHIMP_MARKETING_SERVER_PREFIX;
  await assert.rejects(listMarketingMembersByStatus('cleaned'));
});
