import 'server-only';

import { AuthorizationError, isAdministrator } from '@/lib/membership/authorization';
import { isPrivilegedActor } from '@/lib/membership/account-access';
import { isEntitled } from '@/lib/membership/entitlement';
import { getOwnPrivateMember, requireAccountAccess } from '@/lib/membership/data-access';
import { memberUnreadCount } from '@/lib/support/inbox';

export type MainNavAccess = {
  /** Gates the header's "My IDOC" dropdown and the Contact->Support swap -- mirrors the same
   * convenience check app/(dashboard)/dashboard/layout.tsx uses for the sidebar, never an
   * authorization boundary on its own. */
  entitled: boolean;
  /** entitled && not privileged -- an administrator/super_admin is never a support *member* (see
   * lib/support/inbox.ts's requireSupportMember, which rejects them), so the header must never
   * route one of them into Support in place of the ordinary Contact page. */
  memberSupport: boolean;
  showAdminDashboard: boolean;
  supportUnread: number;
};

const LOGGED_OUT: MainNavAccess = { entitled: false, memberSupport: false, showAdminDashboard: false, supportUnread: 0 };

/** Everything the site header needs to decide what its main navigation shows a visitor: whether
 * they may see the Admin Dashboard link in the initials menu, plus whether this is a signed-in,
 * currently entitled member (or a never-gated administrator/super_admin) -- and, only for an
 * entitled non-privileged member, their unread support-reply count. Never an authorization
 * boundary itself; every underlying dashboard/support page re-checks its own requireAccountAccess
 * independently. The browser continues to receive identity data exclusively through the existing
 * PublicUser shape -- none of this is exposed via /api/user. */
export async function getMainNavAccess(): Promise<MainNavAccess> {
  let actor;
  try {
    actor = await requireAccountAccess('profile');
  } catch (error) {
    if (error instanceof AuthorizationError) return LOGGED_OUT;
    throw error;
  }
  const privileged = isPrivilegedActor(actor);
  const member = await getOwnPrivateMember();
  const entitled = privileged || (member ? isEntitled(member.entitlement, new Date().toISOString().slice(0, 10)) : false);
  const memberSupport = entitled && !privileged;
  return {
    entitled,
    memberSupport,
    showAdminDashboard: isAdministrator(actor),
    supportUnread: memberSupport ? await memberUnreadCount() : 0,
  };
}
