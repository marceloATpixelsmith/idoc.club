'use client';

import { useEffect, useState } from 'react';
import { useCsrfToken } from '@/components/security/csrf-provider';
import { readCsrfTokenFromDocumentCookie } from '@/lib/security/csrf-client';

/** Hidden CSRF evidence field. Include exactly one of these in every <form> that submits a
 * mutating Server Action -- lib/auth/middleware.ts's validatedAction/validatedActionWithUser (and,
 * for the handful of Server Actions outside that wrapper, an explicit requireCsrfToken(formData)
 * call at the top of the action) reject the submission without it. See docs/22's AUTH-CSRF-003 row.
 *
 * The initial value comes from the server-rendered CsrfProvider context (app/layout.tsx reading the
 * cookie at request time) -- required for a no-JS submission, and correct for any hard navigation.
 * But Next's client router can reuse a previously-rendered copy of the (shared, app-wide) root
 * layout across a client-side navigation rather than re-rendering it, so that context value can go
 * stale relative to the live cookie -- e.g. when a mid-flow clearSession() rotates the cookie and
 * the next page is reached via a soft navigation rather than a full reload. Since this cookie is
 * deliberately non-httpOnly for exactly this reason, a JS-enabled client self-heals after mount by
 * re-reading document.cookie directly, so the submitted value always matches whatever the server
 * actually considers current, independent of any layout-segment caching behavior. */
export function CsrfField() {
  const serverToken = useCsrfToken();
  const [token, setToken] = useState(serverToken);

  useEffect(() => {
    const liveToken = readCsrfTokenFromDocumentCookie();
    if (liveToken && liveToken !== token) setToken(liveToken);
  });

  return <input name="csrf_token" type="hidden" value={token} />;
}
