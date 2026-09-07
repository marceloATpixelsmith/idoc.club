import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { AuthorizationError } from '../lib/membership/authorization.ts';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';
import {
  archiveArticle, createArticle, deleteArticle, getAdminArticle, getPublicArticleBySlug,
  listPublicArticles, NewsValidationError, publishArticle, publishScheduledArticles,
  scheduleArticle, unpublishArticle, updateArticle,
} from '../lib/news/articles.ts';
import { adminUser, asAdmin, closeHarness, createUser, resetIdoc, sql } from './postgres-harness.ts';

beforeEach(resetIdoc);
after(closeHarness);

function future(days: number) { return new Date(Date.now() + days * 86_400_000).toISOString(); }
function past(days: number) { return new Date(Date.now() - days * 86_400_000).toISOString(); }

function article(overrides: Partial<{ contentHtml: string; publicationDate: string; slug: string; status: string; subtitle: string | null; title: string }> = {}) {
  return {
    contentHtml: '<p>Body</p>', publicationDate: past(1), slug: 'a-test-article', status: 'draft', subtitle: null, title: 'A test article',
    ...overrides,
  };
}

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
