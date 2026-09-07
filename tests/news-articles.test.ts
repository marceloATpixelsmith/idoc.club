import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { hasVisibleContent, sanitizeArticleContent } from '../lib/news/sanitize.ts';

const source = readFileSync('lib/news/articles.ts', 'utf8');
const actions = readFileSync('app/(dashboard)/admin/news/actions.ts', 'utf8');
const migration = readFileSync('lib/db/migrations/0040_news_articles.sql', 'utf8');
const publicPage = readFileSync('app/(marketing)/news/[slug]/page.tsx', 'utf8');
const listPage = readFileSync('app/(marketing)/news/page.tsx', 'utf8');
const articleView = readFileSync('components/news/article-view.tsx', 'utf8');

test('the four publication states and their length limits are constrained in both the library and the migration', () => {
  for (const value of ['draft', 'scheduled', 'published', 'archived']) assert.match(source, new RegExp(`'${value}'`));
  assert.match(migration, /"status" in \('draft', 'scheduled', 'published', 'archived'\)/);
  assert.match(migration, /char_length\("idoc"\."news_articles"\."title"\) between 1 and 200/);
  assert.match(migration, /char_length\("idoc"\."news_articles"\."content_html"\) between 1 and 20000/);
  assert.match(migration, /"idoc"\."news_articles"\."slug" ~ '\^\[a-z0-9\]\+\(-\[a-z0-9\]\+\)\*\$'/);
  assert.match(migration, /CONSTRAINT "news_articles_slug_unique" UNIQUE\("slug"\)/);
});

test('every mutating library export re-authorizes as an administrator server-side, independent of the UI', () => {
  const mutatingExports = ['createArticle', 'updateArticle', 'publishArticle', 'unpublishArticle', 'scheduleArticle', 'archiveArticle', 'deleteArticle', 'listAdminArticles', 'getAdminArticle'];
  for (const name of mutatingExports) {
    const match = source.match(new RegExp(`export async function ${name}[\\s\\S]*?\\n\\}`));
    assert.ok(match, `${name} not found`);
  }
  assert.match(source, /requireAccountAccess\('administration'\)/);
  assert.match(source, /requireAdministrator\(actor\)/);
});

test('every Server Action requires CSRF evidence before any mutation, directly or through the shared run() helper', () => {
  const runHelper = actions.match(/async function run\([\s\S]*?\n\}/)?.[0];
  assert.ok(runHelper); assert.match(runHelper as string, /requireCsrfToken\(/);
  for (const name of ['createNewsArticle', 'updateNewsArticle', 'publishNewsArticle', 'unpublishNewsArticle', 'scheduleNewsArticle', 'archiveNewsArticle', 'deleteNewsArticle']) {
    const fn = actions.match(new RegExp(`export async function ${name}[\\s\\S]*?\\n\\}`))?.[0];
    assert.ok(fn, `${name} not found`);
    assert.ok(/requireCsrfToken\(/.test(fn as string) || /\brun\(/.test(fn as string), `${name} must call requireCsrfToken directly or via run()`);
  }
});

test('publication scheduling is evaluated server-side in one documented clock (PostgreSQL now(), UTC-normalized input)', () => {
  assert.match(source, /publication_date<=now\(\)/);
  assert.match(source, /publicationDate\.getTime\(\) <= Date\.now\(\)/);
  assert.match(source, /parseAsUtc/);
});

test('deletion enforces the retention rule: only draft or archived articles may be permanently deleted', () => {
  assert.match(source, /existing\.status !== 'draft' && existing\.status !== 'archived'/);
  assert.match(source, /Archive a published or scheduled article before deleting it\./);
});

test('public queries never return draft, scheduled, or archived articles, even by exact slug', () => {
  const publicQueries = source.match(/export async function (?:listPublicArticles|getPublicArticleBySlug)[\s\S]*?\n\}/g) ?? [];
  assert.equal(publicQueries.length, 2);
  for (const query of publicQueries) {
    assert.match(query, /status='published'/);
    assert.match(query, /publication_date<=now\(\)/);
  }
});

test('the public article page 404s rather than rendering when the article is not publicly visible', () => {
  assert.match(publicPage, /if \(!article\) notFound\(\);/);
  assert.match(publicPage, /alternates: \{ canonical/);
});

test('the public listing page has an explicit empty state and pagination', () => {
  assert.match(listPage, /No news articles have been published yet/);
  assert.match(listPage, /hasNext/);
});

test('article HTML is only ever rendered through the one sanitizing view component', () => {
  assert.match(articleView, /sanitizeArticleContent\(contentHtml\)/);
  assert.doesNotMatch(publicPage, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(listPage, /dangerouslySetInnerHTML/);
});

test('sanitizeArticleContent strips scripts, event handlers, and unsafe link schemes while preserving safe formatting', () => {
  const dirty = '<p onclick="steal()">Hello <strong>world</strong></p><script>alert(1)</script>'
    + '<a href="javascript:alert(1)">bad</a><a href="https://idoc.club">good</a><img src=x onerror=alert(1)>';
  const clean = sanitizeArticleContent(dirty);
  assert.doesNotMatch(clean, /<script/);
  assert.doesNotMatch(clean, /onclick=|onerror=/);
  assert.doesNotMatch(clean, /javascript:/);
  assert.doesNotMatch(clean, /<img/);
  assert.match(clean, /<strong>world<\/strong>/);
  assert.match(clean, /<a href="https:\/\/idoc\.club">good<\/a>/);
});

test('hasVisibleContent rejects markup that renders no visible text', () => {
  assert.equal(hasVisibleContent('<p>&nbsp;</p>'), false);
  assert.equal(hasVisibleContent('<p></p>'), false);
  assert.equal(hasVisibleContent('<p>Real content</p>'), true);
});
