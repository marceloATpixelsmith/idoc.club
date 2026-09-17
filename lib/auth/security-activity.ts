/** The subset of idoc.audit_log actions that read as "your own account security activity" -- the
 * My Security page's Activity card (lib/db/queries.ts's getActivityLogs(), rendered by
 * app/(dashboard)/dashboard/security/security-client.tsx). Deliberately excludes audit actions
 * that are just as often self-initiated but belong to a different page's own history instead
 * (member.profile.created, membership.renewal_change_requested, account.onboarding.completed,
 * and the like) -- this is a curated allow-list, not "every audit_log row this user ever caused".
 * No 'server-only': imported by both the server query and the client component that labels it. */
export const SECURITY_ACTIVITY_LABELS: Record<string, string> = {
  'account.session.signed_in': 'Signed in',
  'account.session.signed_out': 'Signed out',
  'account.password.changed': 'Changed password',
  'account.password_reset.completed': 'Reset password',
  'account.email.verified': 'Verified a new email address',
  'auth.mfa.authenticator.enrolled': 'Set up an authenticator app',
  'auth.mfa.authenticator.replaced': 'Replaced the authenticator app',
  'auth.mfa.recovery_codes.regenerated': 'Generated new recovery codes',
  'auth.mfa.recovery_code.rejected': 'A recovery code attempt was rejected',
  'auth.google_identity.linked': 'Linked a Google account',
  'auth.google_identity.unlinked': 'Unlinked a Google account',
  'security.login_device.forgotten': 'Forgot this device',
  'security.login_devices.all_forgotten': 'Forgot all remembered devices',
  'security.session.logged_out': 'Logged out a session',
  'security.sessions.others_logged_out': 'Logged out all other sessions',
};
