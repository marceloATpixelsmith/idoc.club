import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import {
  TURNSTILE_FAILURE_STAGES, reportTurnstileFailure, resetTurnstileFailureReportsForTests,
  type TurnstileFailureSink,
} from '../lib/observability/turnstile-signal.ts';

type Signal = Parameters<TurnstileFailureSink>[0];
beforeEach(() => resetTurnstileFailureReportsForTests());

function collector() {
  const signals: Signal[] = [];
  return { signals, sink: ((signal) => { signals.push(signal); }) as TurnstileFailureSink };
}

test('a failure is reported once per stage and action per page load, however often the widget retries', () => {
  const { signals, sink } = collector();
  for (let i = 0; i < 5; i += 1) reportTurnstileFailure('no_token_after_retries', 'sign-in', undefined, sink);
  reportTurnstileFailure('no_token_after_retries', 'sign-up', undefined, sink);
  reportTurnstileFailure('widget_error', 'sign-in', undefined, sink);
  assert.deepEqual(signals.map((s) => `${s.stage}:${s.action}`), [
    'no_token_after_retries:sign-in', 'no_token_after_retries:sign-up', 'widget_error:sign-in',
  ]);
});

test('only a short slug and a Cloudflare numeric error code can leave the page', () => {
  const { signals, sink } = collector();
  reportTurnstileFailure('widget_error', 'sign-in', '110200', sink as never);
  reportTurnstileFailure('widget_error', 'person@example.com', '110200', sink);
  reportTurnstileFailure('render_failed', 'sign-in', 'free text with an email person@example.com', sink);
  reportTurnstileFailure('unsupported_browser', 'sign-in', { toString: () => '110200' }, sink);
  assert.deepEqual(signals, [
    { action: 'sign-in', errorCode: '110200', stage: 'widget_error' },
    { action: 'unknown', errorCode: '110200', stage: 'widget_error' },
    { action: 'sign-in', errorCode: null, stage: 'render_failed' },
    { action: 'sign-in', errorCode: null, stage: 'unsupported_browser' },
  ]);
});

test('a failing sink never throws into the page', () => {
  assert.doesNotThrow(() => reportTurnstileFailure('script_not_loaded', 'sign-in', undefined, () => { throw new Error('sentry down'); }));
});

test('the stage vocabulary is closed and matches the documented set', () => {
  assert.deepEqual([...TURNSTILE_FAILURE_STAGES], [
    'script_not_loaded', 'render_failed', 'widget_error', 'unsupported_browser', 'no_token_after_retries',
  ]);
});
