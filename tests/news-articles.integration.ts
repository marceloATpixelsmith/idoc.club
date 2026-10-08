import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { AuthorizationError } from '../lib/membership/authorization.ts';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';
import {
  archiveArticle, createArticle, deleteArticle, getAdminArticle, getPublicArticleBySlug,
  listAdminArticles, listPublicArticles, NewsValidationError, publishArticle, publishScheduledArticles,
  scheduleArticle, unpublishArticle, updateArticle,
} from '../lib/news/articles.ts';
import { adminUser, asAdmin, closeHarness, createMembership, createProfile, createUser, judgeRole, resetIdoc, sql, stewardRole, veterinarianRole } from './postgres-harness.ts';

beforeEach(resetIdoc);
after(closeHarness);

function future(days: number) { return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10); }
function past(days: number) { return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10); }

function article(overrides: Partial<{ articleType: string; audience: string[]; contentHtml: string; externalUrl: string | null; publicationDate: string; slug: string; status: string; subtitle: string | null; thumbnailUrl: string | null; title: string }> = {}) {
  return {
    articleType: 'news', audience: ['public'], contentHtml: '<p>Body</p>', externalUrl: null, publicationDate: past(1), slug: 'a-test-article',
    status: 'draft', subtitle: null, thumbnailUrl: null, title: 'A test article',
    ...overrides,
  };
}

test('the administrator article table applies structured filters and bounded pagination on the server', async () => {
  const admin = await adminUser();
  await asAdmin(admin.id, () => createArticle(article({ slug: 'alpha', title: 'Alpha', status: 'published' })));
  await asAdmin(admin.id, () => createArticle(article({ slug: 'beta', title: 'Beta', status: 'draft' })));
  const listing = await asAdmin(admin.id, () => listAdminArticles({
    filters: JSON.stringify([{ id: 'status', operator: 'inArray', value: ['published'] }]),
    pageSize: '10', sort: JSON.stringify([{ id: 'title', desc: false }]),
  }));
  assert.equal(listing.total, 1);
  assert.equal(listing.pageSize, 10);
  assert.equal(listing.rows[0].title, 'Alpha');
  const empty = await asAdmin(admin.id, () => listAdminArticles({
    filters: JSON.stringify([{ id: 'status', operator: 'isEmpty', value: '' }]),
  }));
  const notEmpty = await asAdmin(admin.id, () => listAdminArticles({
    filters: JSON.stringify([{ id: 'status', operator: 'isNotEmpty', value: '' }]),
  }));
  assert.equal(empty.total, 0);
  assert.equal(notEmpty.total, 2);
});

test('a draft article is never publicly visible; publishing it makes it visible by slug and in the listing', async () => {
  const admin = await adminUser();
  const id = await asAdmin(admin.id, () => createArticle(article({ slug: 'draft-then-published' })));
  assert.equal(await getPublicArticleBySlug('draft-then-published'), null);
  await asAdmin(admin.id, () => publishArticle(id));
  const found = await getPublicArticleBySlug('draft-then-published');
  assert.ok(found);
  assert.equal(found.title, 'A test article');
  const { rows } = await listPublicArticles(undefined);
  assert.ok(rows.some((row) => row.slug === 'draft-then-published'));
});

test('member-only and role-specific audiences require entitlement and active professional roles', async () => {
  const admin = await adminUser();
  await asAdmin(admin.id, () => createArticle(article({ audience: ['members'], slug: 'members-only', status: 'published' })));
  await asAdmin(admin.id, () => createArticle(article({ audience: ['judge'], slug: 'judge-only', status: 'published' })));
  await asAdmin(admin.id, () => createArticle(article({ audience: ['steward'], slug: 'steward-only', status: 'published' })));
  await asAdmin(admin.id, () => createArticle(article({ audience: ['veterinarian'], slug: 'vet-only', status: 'published' })));

  assert.equal(await getPublicArticleBySlug('members-only'), null);
  assert.equal(await getPublicArticleBySlug('judge-only'), null);

  const judgeUser = await createUser();
  const judgeProfile = await createProfile(judgeUser.id, [judgeRole]);
  await createMembership(judgeProfile.id);
  await withTestMembershipBoundary({ actor: { id: judgeUser.id, roles: [] } }, async () => {
    assert.ok(await getPublicArticleBySlug('members-only'));
    assert.ok(await getPublicArticleBySlug('judge-only'));
    assert.equal(await getPublicArticleBySlug('steward-only'), null);
    assert.equal(await getPublicArticleBySlug('vet-only'), null);
  });

  const comboUser = await createUser();
  const comboProfile = await createProfile(comboUser.id, [judgeRole, stewardRole]);
  await createMembership(comboProfile.id);
  await withTestMembershipBoundary({ actor: { id: comboUser.id, roles: [] } }, async () => {
    assert.ok(await getPublicArticleBySlug('judge-only'));
    assert.ok(await getPublicArticleBySlug('steward-only'));
    const { rows } = await listPublicArticles(undefined);
    assert.ok(rows.some((row) => row.slug === 'judge-only'));
    assert.ok(rows.some((row) => row.slug === 'steward-only'));
    assert.ok(!rows.some((row) => row.slug === 'vet-only'));
  });

  const vetUser = await createUser();
  const vetProfile = await createProfile(vetUser.id, [veterinarianRole]);
  await createMembership(vetProfile.id);
  await withTestMembershipBoundary({ actor: { id: vetUser.id, roles: [] } }, async () => {
    assert.ok(await getPublicArticleBySlug('vet-only'));
    assert.equal(await getPublicArticleBySlug('judge-only'), null);
  });

  const expiredJudge = await createUser();
  const expiredJudgeProfile = await createProfile(expiredJudge.id, [judgeRole]);
  await createMembership(expiredJudgeProfile.id, false);
  await withTestMembershipBoundary({ actor: { id: expiredJudge.id, roles: [] } }, async () => {
    assert.equal(await getPublicArticleBySlug('members-only'), null);
    assert.equal(await getPublicArticleBySlug('judge-only'), null);
  });
});

test('invalid broad and role audience combinations are rejected server-side', async () => {
  const admin = await adminUser();
  await assert.rejects(
    asAdmin(admin.id, () => createArticle(article({ audience: ['public', 'judge'], slug: 'bad-public-role' }))),
    NewsValidationError,
  );
  await assert.rejects(
    asAdmin(admin.id, () => createArticle(article({ audience: ['members', 'steward'], slug: 'bad-member-role' }))),
    NewsValidationError,
  );
});

test('admin access filter matches any selected compatible audience', async () => {
  const admin = await adminUser();
  await asAdmin(admin.id, () => createArticle(article({ audience: ['public'], slug: 'filter-public' })));
  await asAdmin(admin.id, () => createArticle(article({ audience: ['members'], slug: 'filter-members' })));
  await asAdmin(admin.id, () => createArticle(article({ audience: ['judge'], slug: 'filter-judge' })));
  await asAdmin(admin.id, () => createArticle(article({ audience: ['steward'], slug: 'filter-steward' })));
  await asAdmin(admin.id, () => createArticle(article({ audience: ['judge', 'steward'], slug: 'filter-judge-steward' })));
  await asAdmin(admin.id, () => createArticle(article({ audience: ['veterinarian'], slug: 'filter-veterinarian' })));

  const publicRows = await asAdmin(admin.id, () => listAdminArticles({ access: 'public', pageSize: '100' }));
  assert.deepEqual(publicRows.rows.map((row) => row.slug), ['filter-public']);

  const roleRows = await asAdmin(admin.id, () => listAdminArticles({ access: 'judge,steward', pageSize: '100' }));
  const roleSlugs = new Set(roleRows.rows.map((row) => row.slug));
  assert.deepEqual(roleSlugs, new Set(['filter-judge', 'filter-steward', 'filter-judge-steward']));
});

test('a scheduled article with a future publication date is never publicly reachable, including by its exact slug', async () => {
  const admin = await adminUser();
  await asAdmin(admin.id, () => createArticle(article({ publicationDate: future(2), slug: 'future-article', status: 'scheduled' })));
  assert.equal(await getPublicArticleBySlug('future-article'), null);
  const { rows } = await listPublicArticles(undefined);
  assert.ok(!rows.some((row) => row.slug === 'future-article'));
});

test('scheduling requires a future publication date and rejects a past or present one', async () => {
  const admin = await adminUser();
  await assert.rejects(
    asAdmin(admin.id, () => createArticle(article({ publicationDate: past(1), slug: 'bad-schedule', status: 'scheduled' }))),
    NewsValidationError,
  );
  const id = await asAdmin(admin.id, () => createArticle(article({ slug: 'reschedule-me' })));
  await assert.rejects(asAdmin(admin.id, () => scheduleArticle(id, past(1))), NewsValidationError);
});

test('publishScheduledArticles transitions only overdue scheduled articles, evaluated server-side against PostgreSQL now()', async () => {
  const admin = await adminUser();
  const dueId = await asAdmin(admin.id, () => createArticle(article({ publicationDate: future(1), slug: 'due-now', status: 'scheduled' })));
  // Simulate time having passed since scheduling by moving the row's own publication_date into the
  // past directly -- the library itself never allows writing a past date while status='scheduled'.
  await sql`update idoc.news_articles set publication_date = now() - interval '1 minute' where id=${dueId}`;
  await asAdmin(admin.id, () => createArticle(article({ publicationDate: future(3), slug: 'not-due-yet', status: 'scheduled' })));

  const result = await publishScheduledArticles();
  assert.equal(result.published, 1);

  const due = await getPublicArticleBySlug('due-now');
  assert.ok(due, 'the overdue scheduled article must now be published and publicly visible');
  assert.equal(await getPublicArticleBySlug('not-due-yet'), null, 'the not-yet-due scheduled article must remain hidden');

  const [auditRow] = await sql<{ actor_id: number | null; after_json: { trigger: string } }[]>`
    select actor_id, after_json from idoc.audit_log where entity_type='news_article' and entity_id=${String(dueId)} and action='admin.news_article.published'`;
  assert.equal(auditRow.actor_id, null, 'the scheduled-publish Cron transition is a system action, not attributed to an administrator');
  assert.equal(auditRow.after_json.trigger, 'scheduled_publish_cron');

  // Re-running the scan is idempotent: nothing is left in 'scheduled' state that is still overdue.
  assert.equal((await publishScheduledArticles()).published, 0);
});

test('unpublishing returns a published article to draft and hides it from the public site', async () => {
  const admin = await adminUser();
  const id = await asAdmin(admin.id, () => createArticle(article({ slug: 'now-you-see-it', status: 'published' })));
  assert.ok(await getPublicArticleBySlug('now-you-see-it'));
  await asAdmin(admin.id, () => unpublishArticle(id));
  assert.equal(await getPublicArticleBySlug('now-you-see-it'), null);
  const admin_row = await asAdmin(admin.id, () => getAdminArticle(id));
  assert.equal(admin_row?.status, 'draft');
});

test('archiving hides an article from the public site regardless of its prior status', async () => {
  const admin = await adminUser();
  const id = await asAdmin(admin.id, () => createArticle(article({ slug: 'archive-me', status: 'published' })));
  await asAdmin(admin.id, () => archiveArticle(id));
  assert.equal(await getPublicArticleBySlug('archive-me'), null);
  const row = await asAdmin(admin.id, () => getAdminArticle(id));
  assert.equal(row?.status, 'archived');
  assert.ok(row?.archived_at);
});

test('deletion is only allowed from draft or archived, preserving retained published/scheduled history until archived first', async () => {
  const admin = await adminUser();
  const publishedId = await asAdmin(admin.id, () => createArticle(article({ slug: 'protected', status: 'published' })));
  await assert.rejects(asAdmin(admin.id, () => deleteArticle(publishedId)), NewsValidationError);
  await asAdmin(admin.id, () => archiveArticle(publishedId));
  await asAdmin(admin.id, () => deleteArticle(publishedId));
  assert.equal(await asAdmin(admin.id, () => getAdminArticle(publishedId)), null);
  const [auditRow] = await sql<{ before_json: { slug: string } }[]>`
    select before_json from idoc.audit_log where entity_type='news_article' and entity_id=${String(publishedId)} and action='admin.news_article.deleted'`;
  assert.equal(auditRow.before_json.slug, 'protected');
});

test('duplicate slugs are rejected on create and on update', async () => {
  const admin = await adminUser();
  await asAdmin(admin.id, () => createArticle(article({ slug: 'taken' })));
  await assert.rejects(asAdmin(admin.id, () => createArticle(article({ slug: 'taken', title: 'Another' }))), NewsValidationError);
  const otherId = await asAdmin(admin.id, () => createArticle(article({ slug: 'other' })));
  await assert.rejects(asAdmin(admin.id, () => updateArticle(otherId, article({ slug: 'taken', title: 'Other renamed' }))), NewsValidationError);
});

test('editing an article to change its own slug succeeds and the new slug resolves publicly', async () => {
  const admin = await adminUser();
  const id = await asAdmin(admin.id, () => createArticle(article({ slug: 'old-slug', status: 'published' })));
  await asAdmin(admin.id, () => updateArticle(id, article({ slug: 'new-slug', status: 'published', title: 'Renamed' })));
  assert.equal(await getPublicArticleBySlug('old-slug'), null);
  const renamed = await getPublicArticleBySlug('new-slug');
  assert.equal(renamed?.title, 'Renamed');
});

test('editing article audience records the old and new access boundary in the audit trail', async () => {
  const admin = await adminUser();
  const id = await asAdmin(admin.id, () => createArticle(article({ audience: ['public'], slug: 'audit-audience' })));
  await asAdmin(admin.id, () => updateArticle(id, article({ audience: ['judge', 'steward'], slug: 'audit-audience' })));
  const [auditRow] = await sql<{
    after_json: { audience: string[]; changedFields: string[] };
    before_json: { audience: string[] };
  }[]>`
    select before_json,after_json
    from idoc.audit_log
    where entity_type='news_article' and entity_id=${String(id)} and action='admin.news_article.edited'
    order by id desc
    limit 1`;
  assert.deepEqual(auditRow.before_json.audience, ['public']);
  assert.deepEqual(auditRow.after_json.audience, ['judge', 'steward']);
  assert.ok(auditRow.after_json.changedFields.includes('audience'));
});

test('rich-text content is sanitized before storage: a script tag and event-handler attribute never reach the database', async () => {
  const admin = await adminUser();
  const id = await asAdmin(admin.id, () => createArticle(article({
    contentHtml: '<p onclick="steal()">Safe text</p><script>alert(1)</script>', slug: 'sanitized', status: 'published',
  })));
  const stored = await asAdmin(admin.id, () => getAdminArticle(id));
  assert.doesNotMatch(String(stored?.content_html), /<script|onclick=/);
  assert.match(String(stored?.content_html), /Safe text/);
});

test('an authenticated non-administrator cannot create, edit, or publish an article', async () => {
  const member = await createUser();
  const nonAdmin = { actor: { id: member.id, roles: [] } };
  await assert.rejects(withTestMembershipBoundary(nonAdmin, () => createArticle(article())), AuthorizationError);
});
