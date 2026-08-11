import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  AuthorizationError, requireAdministrator, requireOwnerOrAdmin, requireSuperAdmin,
} from '../lib/membership/authorization.ts';
import { memberProfileSchema, normalizeEmail } from '../lib/membership/validation.ts';
import { isEntitled } from '../lib/membership/entitlement.ts';

const judge = {
  feiId: '10012345', idocRegion: 'Western Europe & Africa',
  isTechnicalDelegate: false, nationalFederationCountryCode: 'DE',
  officialStatus: 'FEI Dressage Judge 1/2**', roleType: 'judge',
};
const common = {
  address1: '1 Main Street', city: 'Aachen', countryCode: 'DE', firstName: 'Ada',
  lastName: 'Example', postalCode: '52062', stateProvince: 'NRW',
};

test('ownership rejects cross-account access but permits an administrator', () => {
  assert.throws(() => requireOwnerOrAdmin({ id: 1, roles: [] }, 2), AuthorizationError);
  assert.doesNotThrow(() => requireOwnerOrAdmin({ id: 1, roles: ['administrator'] }, 2));
});

test('a member cannot escalate to administrator or super admin', () => {
  assert.throws(() => requireAdministrator({ id: 1, roles: ['member'] }), AuthorizationError);
  assert.throws(() => requireSuperAdmin({ id: 1, roles: ['administrator'] }), AuthorizationError);
});

test('validation enforces official fields and canonical countries', () => {
  assert.equal(memberProfileSchema.safeParse({ ...common, roles: [{ roleType: 'judge' }] }).success, false);
  assert.equal(memberProfileSchema.safeParse({ ...common, countryCode: 'XX', roles: [judge] }).success, false);
  assert.equal(memberProfileSchema.safeParse({ ...common, roles: [judge] }).success, true);
});

test('only Judge plus Steward is a valid combined classification', () => {
  assert.equal(memberProfileSchema.safeParse({ ...common, roles: [judge, { roleType: 'veterinarian' }] }).success, false);
});

test('email usernames are normalized and validated', () => {
  assert.equal(normalizeEmail(' Member@IDOC.Club '), 'member@idoc.club');
  assert.throws(() => normalizeEmail('not-email'));
});

test('entitlement comes from current IDOC membership dates and status', () => {
  assert.equal(isEntitled({ status: 'active', validUntil: '2027-01-01' }, '2026-08-11'), true);
  assert.equal(isEntitled({ status: 'suspended', validUntil: '2027-01-01' }, '2026-08-11'), false);
  assert.equal(isEntitled({ status: 'active', validUntil: '2026-01-01' }, '2026-08-11'), false);
});

test('migration makes audit and profile history immutable', () => {
  const migration = readFileSync(new URL('../lib/db/migrations/0002_blue_the_anarchist.sql', import.meta.url), 'utf8');
  assert.match(migration, /audit_log_immutable/);
  assert.match(migration, /profile_change_history_immutable/);
  assert.match(migration, /BEFORE UPDATE OR DELETE/);
});
