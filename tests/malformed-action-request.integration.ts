import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { MALFORMED_ACTION_REQUEST, validatedAction, validatedActionWithUser } from '../lib/auth/middleware.ts';

// Sentry (2026-10-27): POST /sign-up and /recover-password with no form payload threw "undefined is not iterable" and
// "Cannot read properties of undefined (reading 'get')" -- an HTTP 500 for the caller's own malformed request.
const schema = z.object({ email: z.string() });

test('a Server Action posted without its form payload gets the ordinary validation answer, not an unhandled TypeError', async () => {
  let ran = false;
  const open = validatedAction(schema, async () => { ran = true; return { success: 'ran' }; });
  const skipCsrf = validatedAction(schema, async () => { ran = true; return { success: 'ran' }; }, { skipCsrf: true });
  const signedIn = validatedActionWithUser(schema, async () => { ran = true; return { success: 'ran' }; });
  for (const action of [open, skipCsrf, signedIn]) {
    for (const bad of [undefined, null, {}, 'not form data', [['email', 'a@b.c']]]) {
      assert.deepEqual(await action({}, bad as unknown as FormData), MALFORMED_ACTION_REQUEST);
    }
  }
  assert.equal(ran, false, 'the action body is never reached');
});
