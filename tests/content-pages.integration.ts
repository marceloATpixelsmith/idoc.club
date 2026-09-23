import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { listAdminContentPages } from '../lib/content/pages.ts';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';
import { adminUser, closeHarness, resetIdoc, sql } from './postgres-harness.ts';

beforeEach(resetIdoc);
after(closeHarness);

test('administrator content pages list applies audience, structured filters, and paging', async () => {
  const admin = await adminUser();
  const [page] = await sql<{ id: number }[]>`insert into idoc.content_pages
    (slug,title,content_html,status,audience_mode,created_by_user_id,updated_by_user_id)
    values ('test-page','Test page','<p>Body</p>','published','any',${admin.id},${admin.id}) returning id`;
  await sql`insert into idoc.content_page_audiences (page_id,audience) values (${page.id},'public')`;
  const listing = await withTestMembershipBoundary({ actor: { id: admin.id, roles: [] } }, () => listAdminContentPages({
    audience: 'public',
    filters: JSON.stringify([{ id: 'title', operator: 'iLike', value: 'Test' }]),
    pageSize: '10',
    sort: JSON.stringify([{ id: 'title', desc: false }]),
  }));
  assert.equal(listing.total, 1);
  assert.equal(listing.pageSize, 10);
  assert.equal(listing.rows[0].id, page.id);
  assert.equal(listing.rows[0].audiences, 'public');
});
