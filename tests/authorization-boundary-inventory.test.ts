import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

function filesBelow(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(file) : [file];
  });
}

function exportedNames(source: string): string[] {
  return [...source.matchAll(/^export (?:const|async function) (\w+)/gm)].map((match) => match[1]);
}

const actionFiles: Record<string, Record<string, 'session-boundary' | 'pre-authentication' | 'authenticated-continuation' | 'delegates-to-data-access'>> = {
  'app/(login)/actions.ts': {
    signIn: 'pre-authentication', requestPasswordRecovery: 'pre-authentication', requestMigrationActivation: 'pre-authentication',
    resetPassword: 'pre-authentication', activateMigratedAccount: 'pre-authentication', resendVerification: 'pre-authentication',
    signOut: 'pre-authentication', updatePassword: 'session-boundary', deleteAccount: 'session-boundary', updateAccount: 'session-boundary',
  },
  'app/(login)/sign-up/actions.ts': {
    startSignup: 'pre-authentication', verifySignupOtp: 'pre-authentication', resendSignupOtp: 'pre-authentication',
    cancelSignup: 'pre-authentication', completeSignup: 'pre-authentication',
  },
  'app/(login)/sign-in/actions.ts': {
    startLogin: 'pre-authentication', verifyLoginOtp: 'pre-authentication', resendLoginOtp: 'pre-authentication', cancelLogin: 'pre-authentication',
  },
  'app/(login)/recover-password/actions.ts': {
    startPasswordReset: 'pre-authentication', verifyPasswordResetOtp: 'pre-authentication', resendPasswordResetOtp: 'pre-authentication',
    cancelPasswordReset: 'pre-authentication', completePasswordReset: 'pre-authentication',
  },
  'app/(login)/mfa/actions.ts': {
    acknowledgeRecoveryCodes: 'pre-authentication', authorizeAuthenticatorRecovery: 'pre-authentication',
    beginAuthenticatorRecovery: 'pre-authentication', beginLoginWebAuthn: 'pre-authentication',
    beginStepUpWebAuthn: 'authenticated-continuation', cancelMfa: 'pre-authentication',
    confirmTotpEnrollment: 'pre-authentication', verifyLoginTotp: 'pre-authentication',
    verifyLoginWebAuthn: 'pre-authentication', verifyStepUpTotp: 'authenticated-continuation',
    verifyStepUpWebAuthn: 'authenticated-continuation',
  },
  'app/(dashboard)/account/actions.ts': {
    saveOwnMemberProfile: 'delegates-to-data-access', saveOwnMemberProfileForm: 'delegates-to-data-access',
  },
  'app/(dashboard)/onboarding/actions.ts': { completeOnboarding: 'delegates-to-data-access' },
  'app/(dashboard)/dashboard/security/actions.ts': {
    beginAuthenticatorReplacement: 'session-boundary', beginGoogleIdentityLink: 'session-boundary',
    beginPasskeyRegistration: 'session-boundary', disconnectGoogleIdentity: 'session-boundary',
    finishPasskeyRegistration: 'session-boundary', forgetAllRememberedDevices: 'session-boundary',
    forgetThisDevice: 'session-boundary', logOutOtherSessions: 'session-boundary', logOutSession: 'session-boundary',
    removePasskeyCredential: 'session-boundary',
  },
  'lib/payments/actions.ts': { checkoutAction: 'delegates-to-data-access', manageBillingAction: 'delegates-to-data-access' },
  'app/(dashboard)/admin/payments/actions.ts': { recordManualPaymentForm: 'delegates-to-data-access' },
  'app/(dashboard)/admin/members/actions.ts': {
    saveMemberProfileByAdminForm: 'delegates-to-data-access', suspendMembershipForm: 'delegates-to-data-access',
    reinstateMembershipForm: 'delegates-to-data-access', correctEntitlementForm: 'delegates-to-data-access',
    grantRoleForm: 'delegates-to-data-access', revokeRoleForm: 'delegates-to-data-access',
    suspendUserAccountForm: 'delegates-to-data-access', reinstateUserAccountForm: 'delegates-to-data-access',
  },
};

const routeHandlers: Record<string, string> = {
  'app/api/address/autocomplete/route.ts': 'authenticated-provider-proxy',
  'app/api/admin/export/audit-log/route.ts': 'requireSuperAdmin',
  'app/api/admin/export/members/route.ts': 'requireAdministrator',
  'app/api/admin/export/notifications/route.ts': 'requireAdministrator',
  'app/api/admin/export/payments/route.ts': 'requireSuperAdmin',
  'app/api/auth/google/callback/route.ts': 'oauth-state-provider-validation',
  'app/api/auth/google/link/start/route.ts': 'authenticated-fresh-verification-oauth-boundary',
  'app/api/auth/google/link/status/route.ts': 'authenticated-account-boundary',
  'app/api/auth/google/start/route.ts': 'oauth-transaction-boundary',
  'app/api/client-error/route.ts': 'log-only-no-data-access',
  'app/api/cron/account-delivery/route.ts': 'shared-secret-header',
  'app/api/cron/data-retention-purge/route.ts': 'shared-secret-header',
  'app/api/cron/reconciliation-scan/route.ts': 'shared-secret-header',
  'app/api/cron/renewal-notice-delivery/route.ts': 'shared-secret-header',
  'app/api/cron/renewal-notice-scan/route.ts': 'shared-secret-header',
  'app/api/health/route.ts': 'public-liveness-probe-no-data-access',
  'app/api/mailchimp/webhook/route.ts': 'mandrill-signature',
  'app/api/stripe/checkout/route.ts': 'stateless-redirect-no-data-access',
  'app/api/stripe/webhook/route.ts': 'stripe-signature',
  'app/api/team/route.ts': 'always-404-no-data-access',
  'app/api/user/route.ts': 'requireAccountAccess',
};

test('every exported Server Action is accounted for in the authorization inventory', () => {
  for (const [file, manifest] of Object.entries(actionFiles)) {
    const source = readFileSync(path.join(root, file), 'utf8');
    assert.deepEqual(exportedNames(source).sort(), Object.keys(manifest).sort(), `${file}: exported actions drifted from the authorization inventory`);
  }
});

test('every Route Handler is accounted for in the authorization inventory', () => {
  const actual = filesBelow(path.join(root, 'app/api')).filter((file) => file.endsWith('route.ts')).map((file) => path.relative(root, file).replaceAll('\\', '/'));
  assert.deepEqual(actual.sort(), Object.keys(routeHandlers).sort());
});

test('session-boundary actions are wrapped in validatedActionWithUser before any data access', () => {
  for (const [file, manifest] of Object.entries(actionFiles)) {
    const source = readFileSync(path.join(root, file), 'utf8');
    for (const [name, kind] of Object.entries(manifest)) {
      if (kind !== 'session-boundary') continue;
      assert.match(source, new RegExp(`export const ${name} = validatedActionWithUser\\(`), `${file}:${name} must be wrapped in validatedActionWithUser`);
    }
  }
  const authMiddleware = readFileSync(path.join(root, 'lib/auth/middleware.ts'), 'utf8');
  assert.match(authMiddleware, /requireAccountAccess\('account'\)/);
});

test('pre-authentication actions are never wrapped in validatedActionWithUser', () => {
  const source = readFileSync(path.join(root, 'app/(login)/actions.ts'), 'utf8');
  for (const [name, kind] of Object.entries(actionFiles['app/(login)/actions.ts'])) {
    if (kind !== 'pre-authentication' || name === 'signOut') continue;
    assert.match(source, new RegExp(`export const ${name} = validatedAction\\(`));
  }
});

test('Google identity linking actions require current-password fresh verification', () => {
  const source = readFileSync(path.join(root, 'app/(dashboard)/dashboard/security/actions.ts'), 'utf8');
  assert.match(source, /comparePasswords\(currentPassword, user\.passwordHash\)/);
  assert.match(source, /issueGoogleLinkFreshEvidence\(user\.id\)/);
  assert.match(source, /createImmediateGoogleUnlinkFreshEvidence\(user\.id\)/);
});

test('legacy team mutation actions are not exported from the authentication action module', () => {
  const source = readFileSync(path.join(root, 'app/(login)/actions.ts'), 'utf8');
  assert.doesNotMatch(source, /export const (?:removeTeamMember|inviteTeamMember)\b/);
  assert.doesNotMatch(source, /\bteamMembers\b|\binvitations\b|\bgetUserWithTeam\b/);
});

test('the SaaS-starter team-query code path is fully removed, not merely unrouted', () => {
  // /api/team unconditionally 404s (see the route-handler inventory below), but a Codex review
  // caught that the root layout separately called getTeamForUser() on every request as a live SWR
  // fallback -- a real, unreviewed query against idoc.team_members/idoc.teams that serialized its
  // result to the client regardless of whether any component subscribed to it, even though the
  // route itself was inert. Fixed by removing the call, not just leaving the route 404ing.
  const layout = readFileSync(path.join(root, 'app/layout.tsx'), 'utf8');
  assert.doesNotMatch(layout, /getTeamForUser|\/api\/team/);
  const queries = readFileSync(path.join(root, 'lib/db/queries.ts'), 'utf8');
  assert.doesNotMatch(queries, /getTeamForUser|getTeamByStripeCustomerId|updateTeamSubscription|getUserWithTeam|\bteamMembers\b|\bteams\b/);
});

test('activity_logs.ip_address is no longer read or rendered', () => {
  // A Codex review caught that this column -- a plain unhashed varchar(45), never actually written
  // to by any code path -- was still selected by getActivityLogs() and rendered raw on
  // /dashboard/activity, contradicting a blanket "IP is never retained raw" claim elsewhere in this
  // codebase's own security documentation. The column itself is left in the schema (nothing writes
  // to it; dropping it is a separate, more deliberate decision), but the read/render path is gone.
  const queries = readFileSync(path.join(root, 'lib/db/queries.ts'), 'utf8');
  assert.doesNotMatch(queries, /ipAddress/);
  const activityPage = readFileSync(path.join(root, 'app/(dashboard)/dashboard/activity/page.tsx'), 'utf8');
  assert.doesNotMatch(activityPage, /ipAddress|from IP/);
});

test('delegates-to-data-access actions call an ownership-enforcing membership data-access function', () => {
  const expected: Record<string, Array<{ from: string; functionName: string }>> = {
    'app/(dashboard)/account/actions.ts': [{ from: '@/lib/membership/data-access', functionName: 'updateMemberProfile' }],
    'app/(dashboard)/onboarding/actions.ts': [{ from: '@/lib/membership/data-access', functionName: 'createOwnMemberProfile' }],
    'lib/payments/actions.ts': [
      { from: './checkout', functionName: 'createMembershipCheckoutSession' }, { from: './stripe', functionName: 'createMembershipPortalSession' },
    ],
    'app/(dashboard)/admin/payments/actions.ts': [{ from: '@/lib/payments/manual-payments', functionName: 'recordManualPayment' }],
    'app/(dashboard)/admin/members/actions.ts': [
      { from: '@/lib/membership/data-access', functionName: 'updateMemberProfile' },
      { from: '@/lib/membership/status-actions', functionName: 'suspendMembership' },
      { from: '@/lib/membership/status-actions', functionName: 'reinstateMembership' },
      { from: '@/lib/membership/status-actions', functionName: 'correctEntitlement' },
      { from: '@/lib/membership/role-grants', functionName: 'grantApplicationRole' },
      { from: '@/lib/membership/role-grants', functionName: 'revokeApplicationRole' },
      { from: '@/lib/membership/account-suspension', functionName: 'suspendUserAccount' },
      { from: '@/lib/membership/account-suspension', functionName: 'reinstateUserAccount' },
    ],
  };
  for (const [file, entries] of Object.entries(expected)) {
    const source = readFileSync(path.join(root, file), 'utf8');
    for (const { from, functionName } of entries) assert.match(source, new RegExp(`import \\{[^}]*\\b${functionName}\\b[^}]*\\} from '${from.replaceAll('.', '\\.')}'`));
  }
  assert.match(readFileSync(path.join(root, 'lib/payments/checkout.ts'), 'utf8'), /requireAccountAccess\('billing_boundary'\)/);
  assert.match(readFileSync(path.join(root, 'lib/payments/stripe.ts'), 'utf8'), /requireAccountAccess\('billing_boundary'\)/);
  const manualPayments = readFileSync(path.join(root, 'lib/payments/manual-payments.ts'), 'utf8');
  assert.match(manualPayments, /requireAccountAccess\('administration'\)/); assert.match(manualPayments, /requireAdministrator\(/);
  const statusActions = readFileSync(path.join(root, 'lib/membership/status-actions.ts'), 'utf8');
  assert.match(statusActions, /requireAccountAccess\('administration'\)/); assert.match(statusActions, /requireAdministrator\(/);
  const roleGrants = readFileSync(path.join(root, 'lib/membership/role-grants.ts'), 'utf8');
  assert.match(roleGrants, /requireAccountAccess\('administration'\)/); assert.match(roleGrants, /requireSuperAdmin\(/);
  const accountSuspension = readFileSync(path.join(root, 'lib/membership/account-suspension.ts'), 'utf8');
  assert.match(accountSuspension, /requireAccountAccess\('administration'\)/); assert.match(accountSuspension, /requireAdministrator\(/);
});

test('the Google OIDC Route Handlers are bound to canonical transaction, authentication, and link boundaries', () => {
  const start = readFileSync(path.join(root, 'app/api/auth/google/start/route.ts'), 'utf8');
  const callback = readFileSync(path.join(root, 'app/api/auth/google/callback/route.ts'), 'utf8');
  const linkStart = readFileSync(path.join(root, 'app/api/auth/google/link/start/route.ts'), 'utf8');
  const linkStatus = readFileSync(path.join(root, 'app/api/auth/google/link/status/route.ts'), 'utf8');
  assert.match(start, /createGoogleAuthorizationRequest\(/); assert.match(start, /googleOidcTransactionStore/); assert.match(start, /APPLICATION_ID/);
  assert.match(callback, /completeGoogleOidcCallback\(/); assert.match(callback, /googleOidcTransactionStore/); assert.match(callback, /authenticateGoogleIdentity\(/); assert.match(callback, /APPLICATION_ID/);
  assert.match(linkStart, /getUser\(\)/); assert.match(linkStart, /readGoogleLinkFreshEvidence\(user\.id\)/); assert.match(linkStart, /purpose: 'external_identity_link'/); assert.match(linkStart, /authenticatedUserId: String\(user\.id\)/);
  assert.match(linkStatus, /getUser\(\)/); assert.match(linkStatus, /googleIdentityIsLinked\(user\.id\)/);
});

test('the user identity Route Handler requires requireAccountAccess before returning identity data', () => {
  const source = readFileSync(path.join(root, 'app/api/user/route.ts'), 'utf8');
  const authorize = source.indexOf("requireAccountAccess('profile')"); const respond = source.indexOf('Response.json(user');
  assert.ok(authorize >= 0 && respond > authorize);
});

test('the address autocomplete Route Handler authenticates and rate-limits before using the shared provider key', () => {
  const source = readFileSync(path.join(root, 'app/api/address/autocomplete/route.ts'), 'utf8');
  const authenticate = source.indexOf('await getUser()');
  const rateLimit = source.indexOf("checkProviderRateLimit('address_autocomplete'");
  const providerKey = source.indexOf('GEOAPIFY_API_KEY');
  const providerFetch = source.indexOf('await fetch(endpoint');
  assert.ok(authenticate >= 0 && rateLimit > authenticate && providerKey > rateLimit && providerFetch > providerKey);
  assert.match(source, /status: 429/);
  assert.match(source, /Retry-After/);
});

test('the compatibility team Route Handler never touches the database', () => {
  const source = readFileSync(path.join(root, 'app/api/team/route.ts'), 'utf8'); assert.doesNotMatch(source, /\bdb\./); assert.match(source, /status: 404/);
});

test('the client-error reporting Route Handler never touches the database and requires no authorization', () => {
  const source = readFileSync(path.join(root, 'app/api/client-error/route.ts'), 'utf8'); assert.doesNotMatch(source, /\bdb\./); assert.doesNotMatch(source, /requireAccountAccess|requireAdministrator|requireSuperAdmin/);
});

test('the Stripe webhook Route Handler verifies the signature before dispatching any event', () => {
  const source = readFileSync(path.join(root, 'app/api/stripe/webhook/route.ts'), 'utf8'); const verify = source.indexOf('constructEvent'); const dispatch = source.indexOf('processStripeEvent(event, stripe)'); assert.ok(verify >= 0 && dispatch > verify);
});

test('the Mailchimp webhook Route Handler verifies the Mandrill signature before parsing or acting on any event', () => {
  const source = readFileSync(path.join(root, 'app/api/mailchimp/webhook/route.ts'), 'utf8');
  const verify = source.indexOf('verifyMandrillSignature('); const parse = source.indexOf('parseMandrillEvents(');
  assert.ok(verify >= 0 && parse > verify);
});

test('the account-delivery Cron Route Handler is gated by the shared secret before batch processing', () => {
  const source = readFileSync(path.join(root, 'app/api/cron/account-delivery/route.ts'), 'utf8'); assert.match(source, /handleAccountDeliveryCron\(request, \{/); assert.match(source, /secret: cronSecretForServer\(\)/);
});

test('the renewal-notice Cron Route Handlers are gated by the shared secret before batch processing', () => {
  for (const file of ['app/api/cron/renewal-notice-scan/route.ts', 'app/api/cron/renewal-notice-delivery/route.ts']) {
    const source = readFileSync(path.join(root, file), 'utf8'); assert.match(source, /handleAccountDeliveryCron\(request, \{/); assert.match(source, /secret: cronSecretForServer\(\)/);
  }
});

test('the reconciliation-scan Cron Route Handler is gated by the shared secret before batch processing', () => {
  const source = readFileSync(path.join(root, 'app/api/cron/reconciliation-scan/route.ts'), 'utf8'); assert.match(source, /handleAccountDeliveryCron\(request, \{/); assert.match(source, /secret: cronSecretForServer\(\)/);
});

test('the data-retention-purge Cron Route Handler is gated by the shared secret before batch processing', () => {
  const source = readFileSync(path.join(root, 'app/api/cron/data-retention-purge/route.ts'), 'utf8'); assert.match(source, /handleAccountDeliveryCron\(request, \{/); assert.match(source, /secret: cronSecretForServer\(\)/);
});

test('the Stripe checkout return-trip Route Handler never touches the database or calls Stripe, confirming its stateless classification is current', () => {
  const source = readFileSync(path.join(root, 'app/api/stripe/checkout/route.ts'), 'utf8'); assert.doesNotMatch(source, /\bdb\./); assert.doesNotMatch(source, /getStripeServerClient/); assert.match(source, /Response\.redirect/);
});
