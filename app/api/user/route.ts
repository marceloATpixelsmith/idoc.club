import { getPublicUser, getUser } from '@/lib/db/queries';
import { AuthorizationError } from '@/lib/membership/authorization';
import { requireAccountAccess } from '@/lib/membership/data-access';

// This endpoint reports "who is the current session's user, or null" for header/UI display.
// It must be callable by anonymous visitors (every page load hits it), and an expected denial
// must look exactly like "not logged in" to the client, not a distinct error shape —
// requireAccountAccess throws AuthorizationError for both anonymous visitors and accounts in a
// state that shouldn't be shown as logged in (suspended, deleted, unverified), and both cases
// resolve to the same null here. An onboarding account is deliberately not in that list: My
// Membership onboarding now lives inside the dashboard layout itself (docs/16), and that layout's
// header reads this endpoint to render the account's own identity while onboarding is still in
// progress, so onboarding is authorized via the 'onboarding' operation instead. Anything else (a
// database error, for example) is a real operational failure and must propagate as a 500, not be
// swallowed as "signed out".
//
// Explicit no-store (AUTH-TRANSPORT-002): this reflects the caller's own session, so a shared or
// browser-back-forward cache must never serve one visitor's identity to another request.
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET() {
  try {
    const user = await getUser();
    if (!user) throw new AuthorizationError();
    if (user.accountState === 'onboarding') await requireAccountAccess('onboarding');
    else await requireAccountAccess('profile');
  } catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
    return Response.json(null, { headers: NO_STORE });
  }
  return Response.json(await getPublicUser(), { headers: NO_STORE });
}
