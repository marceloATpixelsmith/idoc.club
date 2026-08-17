import { getUser } from '@/lib/db/queries';
import { requireAccountAccess } from '@/lib/membership/data-access';

// This endpoint reports "who is the current session's user, or null" for header/UI display.
// It must be callable by anonymous visitors (every page load hits it), and denial must look
// exactly like "not logged in" to the client, not a distinct error shape — requireAccountAccess
// throws for both anonymous visitors and accounts in a state that shouldn't be shown as logged
// in (onboarding, suspended, deleted, unverified), and both cases resolve to the same null here.
export async function GET() {
  try {
    await requireAccountAccess('profile');
  } catch {
    return Response.json(null);
  }
  const user = await getUser();
  return Response.json(user ? { email: user.email, id: user.id, name: user.name } : null);
}
