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

// Every exported Server Action, and how it reaches the authorization boundary before touching
// privileged data. This is a drift guard: an action added to one of these files without an entry
// here fails the inventory test below, forcing an explicit authorization classification.
const actionFiles: Record<string, Record<string, 'session-boundary' | 'pre-authentication' | 'delegates-to-data-access'>> = {
  'app/(login)/actions.ts': {
    signIn: 'pre-authentication',
    signUp: 'pre-authentication',
    requestPasswordRecovery: 'pre-authentication',
    requestMigrationActivation: 'pre-authentication',
    resetPassword: 'pre-authentication',
    activateMigratedAccount: 'pre-authentication',
    resendVerification: 'pre-authentication',
    signOut: 'pre-authentication',
    updatePassword: 'session-boundary',
    deleteAccount: 'session-boundary',
    updateAccount: 'session-boundary',
    removeTeamMember: 'session-boundary',
    inviteTeamMember: 'session-boundary',
  },
  'app/(dashboard)/account/actions.ts': {
    saveOwnMemberProfile: 'delegates-to-data-access',
    saveOwnMemberProfileForm: 'delegates-to-data-access',
  },
  'app/(dashboard)/onboarding/actions.ts': {
    completeOnboarding: 'delegates-to-data-access',
  },
  'lib/payments/actions.ts': {
    checkoutAction: 'delegates-to-data-access',
    manageBillingAction: 'delegates-to-data-access',
  },
  'app/(dashboard)/admin/payments/actions.ts': {
    recordManualPaymentForm: 'delegates-to-data-access',
  },
  'app/(dashboard)/admin/members/actions.ts': {
    saveMemberProfileByAdminForm: 'delegates-to-data-access',
    suspendMembershipForm: 'delegates-to-data-access',
    reinstateMembershipForm: 'delegates-to-data-access',
    correctEntitlementForm: 'delegates-to-data-access',
    grantRoleForm: 'delegates-to-data-access',
    revokeRoleForm: 'delegates-to-data-access',
  },
};

// Every Route Handler, and how it authorizes before touching privileged data. `stripe/checkout` is
// a stateless return-trip redirect: it never reads Stripe or touches the database, so it needs no
// authorization boundary of its own (real entitlement is granted by the webhook route instead).
const routeHandlers: Record<string, string> = {
  'app/api/admin/export/audit-log/route.ts': 'requireSuperAdmin',
  'app/api/admin/export/members/route.ts': 'requireAdministrator',
  'app/api/admin/export/notifications/route.ts': 'requireAdministrator',
  'app/api/admin/export/payments/route.ts': 'requireSuperAdmin',
  'app/api/client-error/route.ts': 'log-only-no-data-access',
  'app/api/cron/account-delivery/route.ts': 'shared-secret-header',
  'app/api/cron/reconciliation-scan/route.ts': 'shared-secret-header',
  'app/api/cron/renewal-notice-delivery/route.ts': 'shared-secret-header',
  'app/api/cron/renewal-notice-scan/route.ts': 'shared-secret-header',
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
  assert.match(authMiddleware, /requireAccountAccess\('account'\)/, 'validatedActionWithUser must call requireAccountAccess before invoking the wrapped action');
});

test('pre-authentication actions are never wrapped in validatedActionWithUser', () => {
  const source = readFileSync(path.join(root, 'app/(login)/actions.ts'), 'utf8');
  for (const [name, kind] of Object.entries(actionFiles['app/(login)/actions.ts'])) {
    if (kind !== 'pre-authentication' || name === 'signOut') continue;
    assert.match(source, new RegExp(`export const ${name} = validatedAction\\(`), `${name} must use validatedAction, not validatedActionWithUser`);
  }
});

test('delegates-to-data-access actions call an ownership-enforcing membership data-access function', () => {
  const expected: Record<string, Array<{ from: string; functionName: string }>> = {
    'app/(dashboard)/account/actions.ts': [{ from: '@/lib/membership/data-access', functionName: 'updateMemberProfile' }],
    'app/(dashboard)/onboarding/actions.ts': [{ from: '@/lib/membership/data-access', functionName: 'createOwnMemberProfile' }],
    'lib/payments/actions.ts': [
      { from: './checkout', functionName: 'createMembershipCheckoutSession' },
      { from: './stripe', functionName: 'createMembershipPortalSession' },
    ],
    'app/(dashboard)/admin/payments/actions.ts': [{ from: '@/lib/payments/manual-payments', functionName: 'recordManualPayment' }],
    'app/(dashboard)/admin/members/actions.ts': [
      { from: '@/lib/membership/data-access', functionName: 'updateMemberProfile' },
      { from: '@/lib/membership/status-actions', functionName: 'suspendMembership' },
      { from: '@/lib/membership/status-actions', functionName: 'reinstateMembership' },
      { from: '@/lib/membership/status-actions', functionName: 'correctEntitlement' },
      { from: '@/lib/membership/role-grants', functionName: 'grantApplicationRole' },
      { from: '@/lib/membership/role-grants', functionName: 'revokeApplicationRole' },
    ],
  };
  for (const [file, entries] of Object.entries(expected)) {
    const source = readFileSync(path.join(root, file), 'utf8');
    for (const { from, functionName } of entries) {
      assert.match(source, new RegExp(`import \\{[^}]*\\b${functionName}\\b[^}]*\\} from '${from.replaceAll('.', '\\.')}'`), `${file} must call ${functionName} from ${from}`);
    }
  }
  // createMembershipCheckoutSession/createMembershipPortalSession/recordManualPayment must each
  // self-authenticate, the same guarantee updateMemberProfile/createOwnMemberProfile already
  // provide via authenticatedActor.
  assert.match(readFileSync(path.join(root, 'lib/payments/checkout.ts'), 'utf8'), /requireAccountAccess\('billing_boundary'\)/);
  assert.match(readFileSync(path.join(root, 'lib/payments/stripe.ts'), 'utf8'), /requireAccountAccess\('billing_boundary'\)/);
  const manualPayments = readFileSync(path.join(root, 'lib/payments/manual-payments.ts'), 'utf8');
  assert.match(manualPayments, /requireAccountAccess\('administration'\)/);
  assert.match(manualPayments, /requireAdministrator\(/);
  const statusActions = readFileSync(path.join(root, 'lib/membership/status-actions.ts'), 'utf8');
  assert.match(statusActions, /requireAccountAccess\('administration'\)/);
  assert.match(statusActions, /requireAdministrator\(/);
  const roleGrants = readFileSync(path.join(root, 'lib/membership/role-grants.ts'), 'utf8');
  assert.match(roleGrants, /requireAccountAccess\('administration'\)/);
  assert.match(roleGrants, /requireSuperAdmin\(/);
});

test('the user identity Route Handler requires requireAccountAccess before returning identity data', () => {
  const source = readFileSync(path.join(root, 'app/api/user/route.ts'), 'utf8');
  const authorize = source.indexOf("requireAccountAccess('profile')");
  const respond = source.indexOf('Response.json(user');
  assert.ok(authorize >= 0 && respond > authorize, 'requireAccountAccess must run before the identity response is built');
});

test('the compatibility team Route Handler never touches the database', () => {
  const source = readFileSync(path.join(root, 'app/api/team/route.ts'), 'utf8');
  assert.doesNotMatch(source, /\bdb\./);
  assert.match(source, /status: 404/);
});

test('the client-error reporting Route Handler never touches the database and requires no authorization', () => {
  const source = readFileSync(path.join(root, 'app/api/client-error/route.ts'), 'utf8');
  assert.doesNotMatch(source, /\bdb\./);
  assert.doesNotMatch(source, /requireAccountAccess|requireAdministrator|requireSuperAdmin/);
});

test('the Stripe webhook Route Handler verifies the signature before dispatching any event', () => {
  const source = readFileSync(path.join(root, 'app/api/stripe/webhook/route.ts'), 'utf8');
  const verify = source.indexOf('constructEvent');
  const dispatch = source.indexOf('processStripeEvent(event, stripe)');
  assert.ok(verify >= 0 && dispatch > verify, 'the signature must be verified before the event is dispatched');
});

test('the account-delivery Cron Route Handler is gated by the shared secret before batch processing', () => {
  const source = readFileSync(path.join(root, 'app/api/cron/account-delivery/route.ts'), 'utf8');
  assert.match(source, /handleAccountDeliveryCron\(request, \{/);
  assert.match(source, /secret: cronSecretForServer\(\)/);
});

test('the renewal-notice Cron Route Handlers are gated by the shared secret before batch processing', () => {
  for (const file of ['app/api/cron/renewal-notice-scan/route.ts', 'app/api/cron/renewal-notice-delivery/route.ts']) {
    const source = readFileSync(path.join(root, file), 'utf8');
    assert.match(source, /handleAccountDeliveryCron\(request, \{/, file);
    assert.match(source, /secret: cronSecretForServer\(\)/, file);
  }
});

test('the reconciliation-scan Cron Route Handler is gated by the shared secret before batch processing', () => {
  const source = readFileSync(path.join(root, 'app/api/cron/reconciliation-scan/route.ts'), 'utf8');
  assert.match(source, /handleAccountDeliveryCron\(request, \{/);
  assert.match(source, /secret: cronSecretForServer\(\)/);
});

test('the Stripe checkout return-trip Route Handler never touches the database or calls Stripe, confirming its stateless classification is current', () => {
  const source = readFileSync(path.join(root, 'app/api/stripe/checkout/route.ts'), 'utf8');
  assert.doesNotMatch(source, /\bdb\./);
  assert.doesNotMatch(source, /getStripeServerClient/);
  assert.match(source, /Response\.redirect/);
});
