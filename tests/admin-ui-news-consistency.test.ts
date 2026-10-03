import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path: string) {
  return readFileSync(path, 'utf8');
}

test('admin page and drawer headings follow the shared title treatment', () => {
  const drawer = source('components/admin/admin-form-drawer.tsx');
  const member = source('app/(dashboard)/admin/members/member-detail-sheet.tsx');
  assert.match(drawer, /Dialog\.Title className="text-3xl font-semibold text-gold"/);
  assert.match(member, /SheetTitle className="text-3xl font-semibold text-gold">Member<\/SheetTitle>/);

  const expected = [
    ['app/(dashboard)/admin/revenue/page.tsx', 'Membership Revenue'],
    ['app/(dashboard)/admin/reconciliation/page.tsx', 'Stripe Reconciliation'],
    ['app/(dashboard)/admin/email-previews/page.tsx', 'Email Previews'],
    ['app/(dashboard)/admin/security/page.tsx', 'Super Admin Security Operations'],
  ] as const;
  for (const [path, heading] of expected) assert.match(source(path), new RegExp(`>${heading}<\\/h1>`));
});

test('shared button styling keeps text buttons bold and fully rounded', () => {
  const button = source('components/ui/button.tsx');
  const globals = source('app/globals.css');
  assert.match(button, /rounded-full text-sm font-bold/);
  assert.doesNotMatch(button, /xs: "[^"]*text-xs/);
  assert.match(globals, /\.idoc-secondary-button,[\s\S]*border-style: dotted;[\s\S]*font-size: 0\.9375rem;[\s\S]*font-weight: 700;/);
});

test('revenue date filter uses the standard blue dotted filter control', () => {
  const filters = source('app/(dashboard)/admin/revenue/revenue-filters.tsx');
  assert.match(filters, /<Button className="justify-start" data-idoc-table-control variant="outline">/);
});

test('admins can create seminar registrations with manual payment methods only', () => {
  const page = source('app/(dashboard)/admin/seminars/registrations/page.tsx');
  const drawer = source('app/(dashboard)/admin/seminars/registrations/registration-create-drawer.tsx');
  const registrations = source('lib/seminars/registrations.ts');
  assert.match(page, /New Registration/);
  assert.match(page, /RegistrationCreateDrawer/);
  assert.match(drawer, /paymentMethods\.map/);
  assert.doesNotMatch(drawer, /online_stripe/);
  assert.match(registrations, /z\.enum\(MANUAL_PAYMENT_METHODS\)/);
  assert.match(registrations, /enabledMethods\.some/);
  assert.match(registrations, /isEntitled/);
  assert.match(registrations, /memberEntitled \? seminar\.member_price_cents : seminar\.non_member_price_cents/);
  assert.match(registrations, /Admin-created registrations must use Bank Transfer or Cash/);
});

test('public news list reuses homepage cards and article detail has Back to News', () => {
  const home = source('app/(marketing)/page.tsx');
  const news = source('app/(marketing)/news/page.tsx');
  const detail = source('app/(marketing)/news/[slug]/page.tsx');
  assert.match(home, /PublicNewsCard/);
  assert.match(news, /PublicNewsCard/);
  assert.match(news, /listAllPublicArticles\('news'\)/);
  assert.match(detail, /backHref="\/news"/);
  assert.match(detail, /backLabel="Back to News"/);
});
