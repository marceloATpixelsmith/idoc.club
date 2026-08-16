import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { listOwnPaymentHistory } from '../lib/membership/data-access.ts';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';
import { closeHarness, createProfile, createUser, resetIdoc, sql } from './postgres-harness.ts';

beforeEach(resetIdoc);
after(closeHarness);

function asMember<T>(userId: number, operation: () => Promise<T>) {
  return withTestMembershipBoundary({ actor: { id: userId, roles: [] } }, operation);
}

test('listOwnPaymentHistory returns the caller\'s own payments newest first', async () => {
  const user = await createUser();
  const profile = await createProfile(user.id);
  const administrator = await createUser();
  await sql`insert into idoc.payments(profile_id, source, amount_cents, currency, paid_at, administrator_id, reason)
    values (${profile.id}, 'cash', 8000, 'EUR', now() - interval '1 year', ${administrator.id}, 'first payment')`;
  await sql`insert into idoc.payments(profile_id, source, amount_cents, currency, paid_at, administrator_id, reason)
    values (${profile.id}, 'bank_transfer', 8000, 'EUR', now(), ${administrator.id}, 'renewal')`;

  const history = await asMember(user.id, () => listOwnPaymentHistory());
  assert.equal(history.length, 2);
  assert.equal(history[0].source, 'bank_transfer');
  assert.equal(history[1].source, 'cash');
});

test('listOwnPaymentHistory returns an empty array for a member with no payments', async () => {
  const user = await createUser();
  await createProfile(user.id);
  assert.deepEqual(await asMember(user.id, () => listOwnPaymentHistory()), []);
});

test('a member sees only their own payments, never another member\'s', async () => {
  const first = await createUser();
  const firstProfile = await createProfile(first.id);
  const second = await createUser();
  await createProfile(second.id);
  const administrator = await createUser();
  await sql`insert into idoc.payments(profile_id, source, amount_cents, currency, paid_at, administrator_id, reason)
    values (${firstProfile.id}, 'cash', 8000, 'EUR', now(), ${administrator.id}, 'first member payment')`;

  assert.equal((await asMember(first.id, () => listOwnPaymentHistory())).length, 1);
  assert.deepEqual(await asMember(second.id, () => listOwnPaymentHistory()), []);
});

test('the returned rows never expose administrator identity, external payment ids, references, or the admin reason', async () => {
  const user = await createUser();
  const profile = await createProfile(user.id);
  const administrator = await createUser();
  await sql`insert into idoc.payments(profile_id, source, amount_cents, currency, paid_at, administrator_id, reason, reference)
    values (${profile.id}, 'paypal', 8000, 'EUR', now(), ${administrator.id}, 'sensitive administrator note', 'txn-sensitive-reference')`;

  const [row] = await asMember(user.id, () => listOwnPaymentHistory());
  const keys = Object.keys(row).sort();
  assert.deepEqual(keys, ['amountCents', 'currency', 'id', 'paidAt', 'source'].sort());
});
