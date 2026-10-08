import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const members = readFileSync('app/(dashboard)/admin/members/members-table.tsx', 'utf8');
const resources = readFileSync('components/admin/resource-data-table.tsx', 'utf8');
const registrations = readFileSync('app/(dashboard)/admin/seminars/registrations/registrations-table.tsx', 'utf8');
const registrationForm = readFileSync('app/(dashboard)/admin/seminars/registrations/registration-detail-sheet.tsx', 'utf8');
const support = readFileSync('app/(dashboard)/admin/support/support-inbox-table.tsx', 'utf8');
const professionalRoleIcons = readFileSync('components/membership/professional-role-icons.tsx', 'utf8');
const dateRangeFilter = readFileSync('components/admin/date-range-filter.tsx', 'utf8');
const dataTableDateFilter = readFileSync('components/data-table/data-table-date-filter.tsx', 'utf8');
const sitewideIconTooltips = readFileSync('components/site/sitewide-icon-tooltips.tsx', 'utf8');
const facetedFilter = readFileSync('components/data-table/data-table-faceted-filter.tsx', 'utf8');
const resourceListPage = readFileSync('components/admin/resource-list-page.tsx', 'utf8');
const tablePreferences = readFileSync('lib/admin/table-preferences.ts', 'utf8');
const newsArticles = readFileSync('lib/news/articles.ts', 'utf8');

test('record text in admin tables is not used as the edit/open link', () => {
  assert.doesNotMatch(members, /className="font-medium uppercase underline"/);
  assert.doesNotMatch(resources, /id === 'title'[\s\S]*?<Link className="font-medium underline"/);
  assert.doesNotMatch(registrations, /seminar_title[\s\S]{0,500}<Link className="font-medium underline"/);
  assert.doesNotMatch(support, /id: 'subject'[\s\S]{0,500}<Link className="font-medium underline"/);
  assert.doesNotMatch(support, /id: 'member'[\s\S]{0,600}<Link className="font-medium underline"/);
});

test('requested default column order applies only when no saved order is supplied', () => {
  assert.match(members, /initialColumnOrder\?\.split\(','\) \?\? defaultColumnOrder/);
  assert.match(members, /\['select', 'name', 'status', 'type', 'expires', 'region'/);
  assert.match(resources, /\['select', 'title', 'status', 'prices', 'start', 'end', 'deadline', 'registrations', 'actions'\]/);
  assert.match(registrations, /\['select', 'registered', 'registrant', 'seminar', 'status', 'actions'\]/);
  assert.match(support, /\['select', 'activity', 'assigned', 'category', 'subject', 'member', 'status', 'actions'\]/);
});

test('registration search wording is concise', () => {
  assert.match(registrations, /placeholder="Search name or email…"/);
  assert.doesNotMatch(registrations, /Search registrant name or email/);
});

test('registration table and form use branded payment method icons', () => {
  assert.match(registrations, /<PaymentMethodIcon method=\{row\.original\.payment_method_canonical_id\}/);
  assert.match(registrationForm, /<PaymentMethodSelect[\s\S]*?id="paymentMethod"/);
  assert.match(registrationForm, /<PaymentMethodSelect[\s\S]*?id="method"/);
});

test('Judge icon remains the sitewide bell in the admin members table', () => {
  assert.match(members, /judge: \{ icon: Bell/);
  assert.doesNotMatch(members, /\bGavel\b/);
});

test('active admin role icons appear in gold directly after the member name', () => {
  const memberQueries = readFileSync('lib/membership/admin-memberships.ts', 'utf8');
  assert.match(members, /row\.original\.isSuperAdmin && <Shield aria-label="Super Admin" className="size-4 shrink-0 text-gold" data-icon-tooltip="Super Admin" role="img"/);
  assert.match(members, /row\.original\.isAdministrator && <UserCog aria-label="Administrator" className="size-4 shrink-0 text-gold" data-icon-tooltip="Administrator" role="img"/);
  assert.match(members, /row\.original\.isBoardMember && <UsersRound aria-label="Board Member" className="size-4 shrink-0 text-gold" data-icon-tooltip="Board Member" role="img"/);
  assert.match(memberQueries, /coalesce\(app_roles\.is_administrator,false\) "isAdministrator"/);
  assert.match(memberQueries, /coalesce\(app_roles\.is_super_admin,false\) "isSuperAdmin"/);
  assert.match(memberQueries, /where user_id=u\.id and revoked_at is null\) app_roles/);
});

test('Steward uses a horseshoe icon rather than the Super Admin shield', () => {
  assert.match(members, /steward: \{ icon: HorseshoeIcon, label: 'STEWARD' \}/);
  assert.match(members, /import \{ HorseshoeIcon \} from '@\/components\/membership\/professional-role-icons'/);
  assert.match(professionalRoleIcons, /export function HorseshoeIcon/);
  assert.match(professionalRoleIcons, /data-icon-tooltip=\{props\['data-icon-tooltip'\] \?\? 'Steward'\}/);
  assert.match(professionalRoleIcons, /<path d="M5 3v8a7 7 0 0 0 14 0V3h-4v8a3 3 0 0 1-6 0V3H5Z" \/>/);
  assert.match(members, /super_admin: \{ icon: Shield, label: 'SUPERADMIN' \}/);
  assert.match(members, /row\.original\.membershipType === 'combo' && <HorseshoeIcon aria-hidden="true" className="size-4 shrink-0" data-icon-tooltip="STEWARD" \/>/);
});


test('admin date filters allow future years', () => {
  assert.match(dateRangeFilter, /endMonth=\{new Date\(new Date\(\)\.getFullYear\(\) \+ 3, 11\)\}/);
  assert.match(dataTableDateFilter, /endMonth=\{new Date\(new Date\(\)\.getFullYear\(\) \+ 3, 11\)\}/);
});

test('sitewide SVG icons receive tooltips when they do not already provide one', () => {
  assert.match(sitewideIconTooltips, /function tooltipFor\(svg: SVGSVGElement\)/);
  assert.match(sitewideIconTooltips, /svg\.querySelector\(':scope > title'\)/);
  assert.match(sitewideIconTooltips, /svg\.closest<HTMLElement>\('button, a, \[role="button"\], \[role="menuitem"\], \[role="tab"\], \[role="option"\]'\)/);
  assert.doesNotMatch(sitewideIconTooltips, /closest<HTMLElement>\('\[title\], \[aria-label\]'\)/);
  assert.match(sitewideIconTooltips, /new MutationObserver/);
});


test('News Access is a persisted multi-select filter with form-equivalent exclusivity', () => {
  assert.match(resources, /id === 'access' && tableType === 'news'[\s\S]*?exclusiveFilterValues: \['public', 'members'\][\s\S]*?variant: 'multiSelect'/);
  assert.match(resources, /\{ id: 'access', value: initialAccess \? initialAccess\.split\(','\) : \[\] \}/);
  assert.match(resources, /access: tableType === 'news' \? filterToken\(state\.columnFilters, 'access'\) : undefined/);
  assert.match(facetedFilter, /else if \(exclusiveValues\.includes\(option\.value\)\)[\s\S]*?newSelectedValues\.clear\(\)[\s\S]*?exclusiveValues\.forEach\(\(value\) => newSelectedValues\.delete\(value\)\)/);
  assert.match(resourceListPage, /access: typeof preferences\?\.access === 'string' \? preferences\.access : undefined/);
  assert.match(tablePreferences, /access: newsAccessFilter/);
  assert.match(newsArticles, /audience && \$\{audiences\}::varchar\[\]/);
});
