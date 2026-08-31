import { getUser } from '@/lib/db/queries';
import { AuthorizationError } from '@/lib/membership/authorization';
import { requireAccountAccess } from '@/lib/membership/data-access';

// This endpoint reports "who is the current session's user, or null" for header/UI display.
// It must be callable by anonymous visitors (every page load hits it), and an expected denial
// must look exactly like "not logged in" to the client, not a distinct error shape —
// requireAccountAccess throws AuthorizationError for both anonymous visitors and accounts in a
// state that shouldn't be shown as logged in (onboarding, suspended, deleted, unverified), and
// both cases resolve to the same null here. Anything else (a database error, for example) is a
// real operational failure and must propagate as a 500, not be swallowed as "signed out".
//
// Explicit no-store (AUTH-TRANSPORT-002): this reflects the caller's own session, so a shared or
// browser-back-forward cache must never serve one visitor's identity to another request.
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET() {
  try {
    await requireAccountAccess('profile');
  } catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
    return Response.json(null, { headers: NO_STORE });
  }
  const user = await getUser();
  return Response.json(user ? { email: user.email, id: user.id, name: user.name } : null, { headers: NO_STORE });
}
