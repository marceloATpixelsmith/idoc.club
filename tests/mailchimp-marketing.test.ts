import assert from 'node:assert/strict';
import test from 'node:test';

test('Mailchimp add-or-update subscribes both new and existing audience members', async () => {
  process.env.MAILCHIMP_MARKETING_API_KEY = 'test-api-key';
  process.env.MAILCHIMP_MARKETING_AUDIENCE_ID = 'audience';
  process.env.MAILCHIMP_MARKETING_SERVER_PREFIX = 'us1';
  const originalFetch = globalThis.fetch;
  let request: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    request = init;
    return new Response(null, { status: 200 });
  };
  try {
    const { subscribeToMarketingAudience } = await import('../lib/notifications/mailchimp-marketing.ts');
    await subscribeToMarketingAudience(' MEMBER@Example.Test ');
    assert.deepEqual(JSON.parse(String(request?.body)), {
      email_address: 'member@example.test',
      status: 'subscribed',
      status_if_new: 'subscribed',
    });
    assert.equal(request?.method, 'PUT');
    assert.ok(request?.signal);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
