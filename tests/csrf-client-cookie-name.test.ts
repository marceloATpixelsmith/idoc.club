import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEVELOPMENT_CSRF_COOKIE_NAME as CLIENT_DEV_NAME,
  PRODUCTION_CSRF_COOKIE_NAME as CLIENT_PROD_NAME,
  csrfCookieNameForClient,
} from '../lib/security/csrf-client.ts';
import {
  DEVELOPMENT_CSRF_COOKIE_NAME as SERVER_DEV_NAME,
  PRODUCTION_CSRF_COOKIE_NAME as SERVER_PROD_NAME,
  csrfCookieName,
} from '../lib/security/csrf-tokens.ts';

// lib/security/csrf-client.ts mirrors these two constants by hand (it must stay importable from
// client code, so it cannot import lib/security/csrf-tokens.ts, which pulls in 'server-only'). This
// is the drift check csrf-client.ts's module doc promises: if either side's cookie name ever
// changes without the other, readCsrfTokenFromDocumentCookie() would look for the wrong cookie and
// silently send no CSRF evidence at all.
test('the client-mirrored CSRF cookie-name constants never drift from the server-side originals', () => {
  assert.equal(CLIENT_PROD_NAME, SERVER_PROD_NAME);
  assert.equal(CLIENT_DEV_NAME, SERVER_DEV_NAME);
});

test('csrfCookieNameForClient resolves the same name as the server-side csrfCookieName for both environments', () => {
  assert.equal(csrfCookieNameForClient('production'), csrfCookieName({ NODE_ENV: 'production' }));
  assert.equal(csrfCookieNameForClient('development'), csrfCookieName({ NODE_ENV: 'development' }));
  assert.equal(csrfCookieNameForClient(undefined), csrfCookieName({ NODE_ENV: undefined }));
});
