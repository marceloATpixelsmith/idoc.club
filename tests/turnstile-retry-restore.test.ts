import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { consumeRestoredFormValues, saveFormValuesForRetryReload } from '../lib/auth/turnstile-retry-restore.ts';

// Real behavioral tests against a stubbed sessionStorage (plain Node has no DOM/browser globals),
// proving the actual save -> reload -> restore round trip this widget's forced-reload retry path
// depends on -- not just that the two functions exist.

class FakeSessionStorage {
  private store = new Map<string, string>();
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string) { this.store.set(key, value); }
  removeItem(key: string) { this.store.delete(key); }
}

beforeEach(() => {
  (globalThis as { sessionStorage?: unknown }).sessionStorage = new FakeSessionStorage();
});

function fakeForm(inputs: Array<{ name: string; type: string; value: string }>) {
  return { querySelectorAll: (selector: string) => inputs.filter((input) => selector.includes(`type="${input.type}"`)) } as unknown as HTMLFormElement;
}

test('saving then consuming round-trips the exact values typed into visible email/text inputs', () => {
  const form = fakeForm([
    { name: 'email', type: 'email', value: 'member@example.test' },
    { name: 'displayName', type: 'text', value: 'Some Member' },
  ]);
  saveFormValuesForRetryReload(form);
  assert.deepEqual(consumeRestoredFormValues(), { email: 'member@example.test', displayName: 'Some Member' });
});

test('hidden fields (the CSRF token, the Turnstile token itself) are never saved or restorable, even if present in the form', () => {
  const form = fakeForm([
    { name: 'email', type: 'email', value: 'member@example.test' },
    { name: 'csrf_token', type: 'hidden', value: 'real-csrf-token-value' },
    { name: 'turnstileToken', type: 'hidden', value: 'real-turnstile-token' },
  ]);
  saveFormValuesForRetryReload(form);
  const restored = consumeRestoredFormValues();
  assert.deepEqual(restored, { email: 'member@example.test' });
  assert.equal('csrf_token' in restored, false);
  assert.equal('turnstileToken' in restored, false);
});

test('consuming is single-use: a second read after the first sees nothing, so an ordinary later page load never restores a stale value', () => {
  saveFormValuesForRetryReload(fakeForm([{ name: 'email', type: 'email', value: 'member@example.test' }]));
  assert.deepEqual(consumeRestoredFormValues(), { email: 'member@example.test' });
  assert.deepEqual(consumeRestoredFormValues(), {});
});

test('a null form, a form with no matching inputs, or nothing ever saved all consume as an empty object, never throwing', () => {
  saveFormValuesForRetryReload(null);
  assert.deepEqual(consumeRestoredFormValues(), {});
  saveFormValuesForRetryReload(fakeForm([]));
  assert.deepEqual(consumeRestoredFormValues(), {});
  assert.deepEqual(consumeRestoredFormValues(), {});
});

test('a corrupted stored value (malformed JSON, or valid JSON that is not a plain object of strings) is treated as nothing to restore, never thrown', () => {
  (globalThis.sessionStorage as unknown as FakeSessionStorage).setItem('idoc-turnstile-retry-restore', 'not json');
  assert.deepEqual(consumeRestoredFormValues(), {});

  (globalThis.sessionStorage as unknown as FakeSessionStorage).setItem('idoc-turnstile-retry-restore', '[1,2,3]');
  assert.deepEqual(consumeRestoredFormValues(), {});

  (globalThis.sessionStorage as unknown as FakeSessionStorage).setItem('idoc-turnstile-retry-restore', JSON.stringify({ email: 42, name: 'kept' }));
  assert.deepEqual(consumeRestoredFormValues(), { name: 'kept' });
});

test('a sessionStorage that throws (private-browsing block) never propagates -- save is a silent no-op and consume returns empty', () => {
  const throwing = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };
  (globalThis as { sessionStorage?: unknown }).sessionStorage = throwing;
  assert.doesNotThrow(() => saveFormValuesForRetryReload(fakeForm([{ name: 'email', type: 'email', value: 'x@example.test' }])));
  assert.deepEqual(consumeRestoredFormValues(), {});
});
