import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('membership perks remain Super-Admin-only to read and write', () => {
  const lib = readFileSync(new URL('../lib/organization/membership-perks.ts', import.meta.url), 'utf8');
  assert.match(lib, /export async function getMembershipPerksForAdmin\(actor: Actor\): Promise<MembershipPerk\[\]> \{\s*requireSuperAdmin\(actor\)/);
  assert.match(lib, /export async function updateMembershipPerks\(actor: Actor, labels: string\[\]\): Promise<void> \{\s*requireSuperAdmin\(actor\)/);
});

test('the public perk read never requires an actor, so the marketing and dashboard pages can call it unauthenticated', () => {
  const lib = readFileSync(new URL('../lib/organization/membership-perks.ts', import.meta.url), 'utf8');
  assert.match(lib, /export async function getMembershipPerks\(\): Promise<MembershipPerk\[\]> \{/);
  assert.doesNotMatch(lib.slice(lib.indexOf('export async function getMembershipPerks('), lib.indexOf('export async function getMembershipPerksForAdmin')), /requireSuperAdmin/);
});

test('the organization-settings admin layout gates the whole page (including the perks form) behind Super-Admin, 404-ing everyone else', () => {
  const layout = readFileSync(new URL('../app/(dashboard)/admin/organization/layout.tsx', import.meta.url), 'utf8');
  assert.match(layout, /requireSuperAdmin\(actor\)/);
  assert.match(layout, /notFound\(\)/);
  const page = readFileSync(new URL('../app/(dashboard)/admin/organization/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /getMembershipPerksForAdmin\(actor\)/);
  assert.match(page, /<MembershipPerksForm perks=\{perks\}/);
});

test('saving perks is CSRF-protected and revalidates every surface that renders them', () => {
  const action = readFileSync(new URL('../app/(dashboard)/admin/organization/actions.ts', import.meta.url), 'utf8');
  const body = action.slice(action.indexOf('export async function saveMembershipPerks'));
  assert.match(body, /requireCsrfToken\(formData, await rawCanonicalSessionId\(\), await rawCanonicalUserId\(\)\)/);
  assert.match(body, /requireAccountAccess\('administration'\)/);
  assert.match(body, /updateMembershipPerks\(actor, formData\.getAll\('perk'\)\.map\(String\)\)/);
  assert.match(body, /revalidatePath\('\/membership'\)/);
  assert.match(body, /revalidatePath\('\/pricing'\)/);
});

test('the update path rejects an empty perk list rather than silently clearing the table', () => {
  const lib = readFileSync(new URL('../lib/organization/membership-perks.ts', import.meta.url), 'utf8');
  assert.match(lib, /if \(cleaned\.length === 0\) throw new Error\('At least one perk is required\.'\);/);
});

test('the migration seeds the same four perks the membership page previously hardcoded', () => {
  const migration = readFileSync(new URL('../lib/db/migrations/0046_membership_perks.sql', import.meta.url), 'utf8');
  for (const label of ['Member area access', 'Seminar priority information', 'IDOC documents \\& GA papers', "Officials'' directory"]) {
    assert.match(migration, new RegExp(label));
  }
});

test('the public membership page and the dashboard payment box both render the database-backed perk list through the shared list component', () => {
  const membershipPage = readFileSync(new URL('../app/(marketing)/membership/page.tsx', import.meta.url), 'utf8');
  assert.match(membershipPage, /const perks = await getMembershipPerks\(\);/);
  assert.match(membershipPage, /<MembershipPerksList className="mt-7 flex-1 space-y-3 text-sm" perks=\{perks\} \/>/);

  const pricingPage = readFileSync(new URL('../app/(dashboard)/pricing/page.tsx', import.meta.url), 'utf8');
  assert.match(pricingPage, /const perks = await getMembershipPerks\(\);/);
  assert.match(pricingPage, /<MembershipPerksList className="mt-7 space-y-3 text-sm" perks=\{perks\} \/>/);
  assert.match(pricingPage, /<CheckoutForm label="Pay" \/>/);
});

test('the dashboard payment box reuses the same card-midnight box style as the public membership tiers', () => {
  const pricingPage = readFileSync(new URL('../app/(dashboard)/pricing/page.tsx', import.meta.url), 'utf8');
  assert.match(pricingPage, /className="card-midnight flex flex-col p-8"/);
});
