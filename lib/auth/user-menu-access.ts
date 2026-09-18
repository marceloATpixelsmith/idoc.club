import 'server-only';

import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { memberships, profiles } from '@/lib/db/schema';
import { AuthorizationError, isAdministrator } from '@/lib/membership/authorization';
import { isPrivilegedActor } from '@/lib/membership/account-access';
import { isEntitled } from '@/lib/membership/entitlement';
import { requireAccountAccess } from '@/lib/membership/data-access';

export type MainNavAccess = {
  /** Gates the header's "My IDOC" dropdown (a plain /pricing link otherwise, see signedIn) --
   * mirrors the same convenience check app/(dashboard)/dashboard/layout.tsx uses for the sidebar,
   * never an authorization boundary on its own. */
  entitled: boolean;
  /** entitled && not privileged -- an administrator/super_admin is never a support *member* (see
   * lib/support/inbox.ts's requireSupportMember, which rejects them), so the header must never
   * offer Support (inside the My IDOC dropdown) to one of them. */
  memberSupport: boolean;
  /** A signed-in, non-entitled (never-paid or post-grace-expired) member still needs a way back
   * into the payment flow from the header -- the "My IDOC" nav item falls back to a plain link to
   * /pricing (rather than the dashboard-subpages dropdown) whenever this is true and entitled is
   * false. Distinct from entitled: every entitled visitor is also signedIn, but not the reverse. */
  signedIn: boolean;
  showAdminDashboard: boolean;
};

const LOGGED_OUT: MainNavAccess = { entitled: false, memberSupport: false, showAdminDashboard: false, signedIn: false };

/** The header renders on every single page, so this mirrors exactly what
 * lib/membership/data-access.ts's authenticatedActor() already computes internally for its own
 * entitlement-gated policy check (profile id, then that profile's latest membership row) -- a
 * direct, minimal two-query read rather than going through getOwnPrivateMember()/getPrivateMember(),
 * which additionally fetch professional roles, subscription, and account email that nav visibility
 * never needs (a Codex review finding on this pull request: the original version's per-page-load
 * cost compounded to 20+ SQL statements once the dashboard's own nested layout repeated it). */
async function isCurrentlyEntitled(userId: number): Promise<boolean> {
  const [profile] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (!profile) return false;
  const [latest] = await db.select({ status: memberships.status, validUntil: memberships.validUntil })
    .from(memberships).where(eq(memberships.profileId, profile.id)).orderBy(desc(memberships.validUntil)).limit(1);
  return latest ? isEntitled(latest, new Date().toISOString().slice(0, 10)) : false;
}

/** Everything the site header needs to decide what its main navigation shows a visitor: whether
 * they may see the Admin Dashboard link in the initials menu, plus whether this is a signed-in,
 * currently entitled member (or a never-gated administrator/super_admin). Never an authorization
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
  const entitled = privileged || (await isCurrentlyEntitled(actor.id));
  return {
    entitled,
    memberSupport: entitled && !privileged,
    showAdminDashboard: isAdministrator(actor),
    signedIn: true,
  };
}
