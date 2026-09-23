import assert from 'node:assert/strict';
import test from 'node:test';
import { reportClientError } from '../lib/report-client-error.ts';

test('admin error occurrence sends no error text and returns a server-generated log reference', async () => {
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  const reference = '39431185-caab-4a8f-9ae7-2ed8c5cf922c';
  let submitted: string | undefined;
  globalThis.fetch = async (input, init) => {
    assert.equal(input, '/api/client-error');
    submitted = String(init?.body);
    return Response.json({ requestId: reference });
  };
  console.error = () => {};
  try {
    const error = Object.assign(new Error('private member detail'), { digest: '12345' });
    assert.equal(await reportClientError(error), reference);
    assert.equal(submitted, '{}');
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  }
});

test('admin error occurrence fails safely if reporting is unavailable or its reference is invalid', async () => {
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    globalThis.fetch = async () => { throw new Error('offline'); };
    assert.equal(await reportClientError(new Error('offline')), null);
    globalThis.fetch = async () => Response.json({ requestId: 'untrusted value' });
    assert.equal(await reportClientError(new Error('invalid response')), null);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  }
});
