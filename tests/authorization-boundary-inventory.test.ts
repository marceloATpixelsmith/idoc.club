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
    checkoutAction: 'session-boundary',
    customerPortalAction: 'session-boundary',
  },
};

// Every Route Handler, and how it authorizes before touching privileged data. `stripe/checkout` is
// unmigrated legacy-starter code (still writes to the compatibility `teams` table, not the IDOC
// membership model) and is explicitly out of scope for Release 1; it is inventoried here so it
// cannot silently gain new behavior without this test being revisited.
const routeHandlers: Record<string, string> = {
  'app/api/cron/account-delivery/route.ts': 'shared-secret-header',
  'app/api/stripe/checkout/route.ts': 'release-2-unmigrated-legacy',
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

test('session-boundary actions are wrapped in validatedActionWithUser or withTeam before any data access', () => {
  for (const [file, manifest] of Object.entries(actionFiles)) {
    const source = readFileSync(path.join(root, file), 'utf8');
    for (const [name, kind] of Object.entries(manifest)) {
      if (kind !== 'session-boundary') continue;
      assert.match(source, new RegExp(`export const ${name} = (?:validatedActionWithUser|withTeam)\\(`), `${file}:${name} must be wrapped in validatedActionWithUser or withTeam`);
    }
  }
  const authMiddleware = readFileSync(path.join(root, 'lib/auth/middleware.ts'), 'utf8');
  assert.match(authMiddleware, /requireAccountAccess\('account'\)/, 'validatedActionWithUser must call requireAccountAccess before invoking the wrapped action');
  assert.match(authMiddleware, /requireAccountAccess\('billing_boundary'\)/, 'withTeam must call requireAccountAccess before invoking the wrapped action');
});

test('pre-authentication actions are never wrapped in validatedActionWithUser', () => {
  const source = readFileSync(path.join(root, 'app/(login)/actions.ts'), 'utf8');
  for (const [name, kind] of Object.entries(actionFiles['app/(login)/actions.ts'])) {
    if (kind !== 'pre-authentication' || name === 'signOut') continue;
    assert.match(source, new RegExp(`export const ${name} = validatedAction\\(`), `${name} must use validatedAction, not validatedActionWithUser`);
  }
});

test('delegates-to-data-access actions call an ownership-enforcing membership data-access function', () => {
  const expected: Record<string, string> = {
    'app/(dashboard)/account/actions.ts': 'updateMemberProfile',
    'app/(dashboard)/onboarding/actions.ts': 'createOwnMemberProfile',
  };
  for (const [file, functionName] of Object.entries(expected)) {
    const source = readFileSync(path.join(root, file), 'utf8');
    assert.match(source, new RegExp(`import \\{[^}]*\\b${functionName}\\b[^}]*\\} from '@/lib/membership/data-access'`), `${file} must call ${functionName} from lib/membership/data-access`);
  }
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

test('the Stripe webhook Route Handler verifies the signature before dispatching any event', () => {
  const source = readFileSync(path.join(root, 'app/api/stripe/webhook/route.ts'), 'utf8');
  const verify = source.indexOf('constructEvent');
  const dispatch = source.indexOf('processStripeEvent(event)');
  assert.ok(verify >= 0 && dispatch > verify, 'the signature must be verified before the event is dispatched');
});

test('the account-delivery Cron Route Handler is gated by the shared secret before batch processing', () => {
  const source = readFileSync(path.join(root, 'app/api/cron/account-delivery/route.ts'), 'utf8');
  assert.match(source, /handleAccountDeliveryCron\(request, \{/);
  assert.match(source, /secret: cronSecretForServer\(\)/);
});

test('the unmigrated Stripe checkout Route Handler still targets the compatibility teams table, confirming its legacy-scope classification is current', () => {
  const source = readFileSync(path.join(root, 'app/api/stripe/checkout/route.ts'), 'utf8');
  assert.match(source, /from '@\/lib\/db\/schema'/);
  assert.match(source, /\bteams\b/);
  assert.doesNotMatch(source, /requireAccountAccess/, 'if this route is migrated to call requireAccountAccess, its classification above must be revisited');
});
