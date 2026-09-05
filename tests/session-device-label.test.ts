import assert from 'node:assert/strict';
import test from 'node:test';
import { describeUserAgent } from '../lib/auth/session-device-label.ts';

test('describeUserAgent identifies common real browser/OS combinations', () => {
  assert.equal(describeUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36'),
    'Chrome on macOS');
  assert.equal(describeUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36'),
    'Chrome on Windows');
  assert.equal(describeUserAgent(
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'),
    'Safari on iPhone');
  assert.equal(describeUserAgent(
    'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'),
    'Safari on iPad');
  assert.equal(describeUserAgent(
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Mobile Safari/537.36'),
    'Chrome on Android');
  assert.equal(describeUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'),
    'Safari on macOS');
  assert.equal(describeUserAgent(
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36'),
    'Chrome on Linux');
  assert.equal(describeUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36 Edg/117.0.2045.47'),
    'Edge on Windows');
  assert.equal(describeUserAgent(
    'Mozilla/5.0 (X11; Fedora; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/117.0'),
    'Firefox on Linux');
});

test('describeUserAgent falls back to whichever half it can identify, or null for neither', () => {
  assert.equal(describeUserAgent('SomeCustomBot/1.0'), null);
  assert.equal(describeUserAgent(''), null);
  assert.equal(describeUserAgent('   '), null);
  assert.equal(describeUserAgent(null), null);
  // Only an OS token, no recognizable browser token.
  assert.equal(describeUserAgent('SomeCustomBot/1.0 (Windows NT 10.0)'), 'Windows');
  // Only a browser token, no recognizable OS token.
  assert.equal(describeUserAgent('Chrome/117.0.0.0'), 'Chrome');
});

test('describeUserAgent never returns the raw User-Agent string itself, only the short derived label', () => {
  const rawUserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36';
  const label = describeUserAgent(rawUserAgent);
  assert.ok(label);
  assert.ok(label!.length < rawUserAgent.length);
  assert.doesNotMatch(label!, /Mozilla|AppleWebKit|KHTML|537\.36/);
});

test('describeUserAgent caps an implausibly long label rather than persisting it unbounded', () => {
  const label = describeUserAgent(`Chrome/117.0.0.0 ${'Windows NT 10.0 '.repeat(50)}`);
  assert.ok(label);
  assert.ok(label!.length <= 100);
});
