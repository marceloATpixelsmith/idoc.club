import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const memberPage = readFileSync(new URL('../app/(dashboard)/admin/members/page.tsx', import.meta.url), 'utf8');
const memberQueries = readFileSync(new URL('../lib/membership/admin-memberships.ts', import.meta.url), 'utf8');
const revenueReport = readFileSync(new URL('../lib/payments/revenue-report.ts', import.meta.url), 'utf8');
const revenuePage = readFileSync(new URL('../app/(dashboard)/admin/revenue/page.tsx', import.meta.url), 'utf8');
const adminSupportThreadPage = readFileSync(new URL('../app/(dashboard)/admin/support/[publicId]/page.tsx', import.meta.url), 'utf8');

test('member pagination preserves every normalized active filter while replacing only page', () => {
  assert.match(memberPage, /Object\.entries\(listing\.filters\)/);
  assert.match(memberPage, /key !== 'page'/);
  assert.match(memberPage, /query\.set\('page', String\(page\)\)/);
  assert.match(memberPage, /paginationHref\(listing\.filters\.page - 1\)/);
  assert.match(memberPage, /paginationHref\(listing\.filters\.page \+ 1\)/);
});

test('membership status options and effective status preserve review-required records', () => {
  assert.match(memberQueries, /'review_required'/);
  assert.match(memberQueries, /m\.status = 'review_required' then 'review_required'/);
  assert.match(memberPage, /MEMBERSHIP_STATUSES\.map/);
});

test('malformed page parameters fall back before SQL offset is calculated', () => {
  assert.match(memberQueries, /const page = pageNumber\(input\.page\)/);
  assert.match(memberQueries, /Number\.isSafeInteger\(page\) && page > 0 \? page : 1/);
  assert.doesNotMatch(memberQueries, /Math\.trunc\(input\.page/);
});

test('an array-valued (repeated-key) filter is resolved to its first value before any string method is called on it', () => {
  assert.match(memberQueries, /function firstValue\(value: RawFilterValue\): string \| undefined \{\s*\n\s*return Array\.isArray\(value\) \? value\[0\] : value;/);
  for (const field of ['country', 'expiresFrom', 'expiresTo', 'federation', 'membershipType', 'q', 'region', 'sort', 'status']) {
    assert.match(memberQueries, new RegExp(`firstValue\\(input\\.${field}\\)`));
  }
});

test('revenue report boundaries are explicit inclusive UTC calendar dates', () => {
  assert.match(revenueReport, /paid_at >= \(\$\{range\.from\}::date::timestamp at time zone 'UTC'\)/);
  assert.match(revenueReport, /paid_at < \(\(\$\{range\.to\}::date::timestamp at time zone 'UTC'\) \+ interval '1 day'\)/);
});

test('the revenue report resolves an array-valued (repeated-key) filter to its first value before any string method or SQL parameter use', () => {
  assert.match(revenueReport, /function firstValue\(value: RawFilterValue\): string \| undefined \{\s*\n\s*return Array\.isArray\(value\) \? value\[0\] : value;/);
  for (const field of ['from', 'to']) assert.match(revenueReport, new RegExp(`firstValue\\(input\\.${field}\\)`));
  assert.match(revenueReport, /const source = firstValue\(input\.source\)/);
  assert.match(revenueReport, /const origin = firstValue\(input\.origin\)/);
});

test('the revenue page catches an invalid-date-range rejection and renders it inline instead of an uncaught 500', () => {
  assert.match(revenuePage, /try \{\s*\n\s*report = await getRevenueReport\(filters\);/);
  assert.match(revenuePage, /catch \(thrown\)/);
  assert.match(revenuePage, /role="alert"/);
});

test('the revenue page has an explicit empty state for both breakdown tables, not just the summary cards', () => {
  assert.match(revenuePage, /report\.bySource\.length === 0/);
  assert.match(revenuePage, /report\.overTime\.length === 0/);
});

test('the admin support thread page resolves an array-valued returnTo parameter to its first value before calling startsWith on it', () => {
  assert.match(adminSupportThreadPage, /searchParams: Promise<Record<string, string \| string\[\] \| undefined>>/);
  assert.match(adminSupportThreadPage, /const returnToParam = Array\.isArray\(query\.returnTo\) \? query\.returnTo\[0\] : query\.returnTo;/);
  assert.match(adminSupportThreadPage, /returnToParam\?\.startsWith\('\/admin\/support'\) \? returnToParam : '\/admin\/support'/);
});
