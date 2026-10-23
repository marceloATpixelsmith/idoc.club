import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const actions = readFileSync('app/(login)/actions.ts', 'utf8');
const signInPage = readFileSync('app/(login)/sign-in/page.tsx', 'utf8');

function actionBody(name: string) {
  const start = actions.indexOf(`export const ${name} = `);
  assert.ok(start >= 0, `${name} must exist`);
  return actions.slice(start, actions.indexOf('\n});', start));
}

test('a successful emailed-link activation or reset redirects to member login instead of leaving the form on screen', () => {
  const activate = actionBody('activateMigratedAccount');
  const reset = actionBody('resetPassword');
  assert.match(activate, /return finishTokenPasswordFlow\('account-activated'\)/);
  assert.match(reset, /return finishTokenPasswordFlow\('password-reset-success'\)/);
  assert.doesNotMatch(activate, /success:/, 'activation must not return an inline success banner');
  assert.doesNotMatch(reset, /success:/, 'reset must not return an inline success banner');
  assert.match(actions, /await clearPendingLogin\(\);\s*await setUiFlash\(flash, '\/sign-in'\);\s*redirect\('\/sign-in'\);/);
  assert.match(signInPage, /code === 'account-activated'/);
  assert.match(signInPage, /code === 'password-reset-success'/);
});
