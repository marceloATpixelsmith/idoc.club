import 'server-only';

import { AuthorizationError, isAdministrator } from '@/lib/membership/authorization';
import { requireAccountAccess } from '@/lib/membership/data-access';

/** Returns only the single capability the authenticated navigation needs. The browser continues
 * to receive identity data exclusively through the existing PublicUser shape. */
export async function mayShowAdminDashboard(): Promise<boolean> {
  try {
    return isAdministrator(await requireAccountAccess('profile'));
  } catch (error) {
    if (error instanceof AuthorizationError) return false;
    throw error;
  }
}
