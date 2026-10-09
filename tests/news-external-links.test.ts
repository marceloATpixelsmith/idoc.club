import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const articles = readFileSync('lib/news/articles.ts', 'utf8');
const actions = readFileSync('app/(dashboard)/admin/news/actions.ts', 'utf8');
const newsDrawer = readFileSync('app/(dashboard)/admin/news/news-drawer.tsx', 'utf8');
const newsPage = readFileSync('app/(marketing)/news/page.tsx', 'utf8');
const publicNewsCard = readFileSync('components/news/public-news-card.tsx', 'utf8');
const blogPage = readFileSync('app/(marketing)/blog/page.tsx', 'utf8');
const home = readFileSync('app/(marketing)/page.tsx', 'utf8');
const migration = readFileSync('lib/db/migrations/0065_news_external_links.sql', 'utf8');

test('News Blog admin supports validated optional external links', () => {
  assert.match(newsDrawer, /name="externalUrl"/);
  assert.match(actions, /externalUrl: formData\.get\('externalUrl'\)/);
  assert.match(articles, /External link must be a valid http:\/\/ or https:\/\/ URL/);
  assert.match(migration, /external_url ~\* '\^https\?:\/\/'/);
});

test('external-link blurbs may omit a body while internal articles still require one', () => {
  assert.match(articles, /if \(!externalUrl && !hasVisibleContent\(sanitizedContent\)\)/);
  assert.match(migration, /external_url is null and char_length\(content_html\) between 1 and 20000/);
  assert.match(migration, /external_url is not null and char_length\(content_html\) between 0 and 20000/);
});

test('public News Blog cards open external links in a new tab and keep internal routes otherwise', () => {
  assert.match(newsPage, /PublicNewsCard/);
  assert.match(home, /PublicNewsCard/);
  for (const source of [publicNewsCard, blogPage]) {
    assert.match(source, /external_url/);
    assert.match(source, /target.*_blank|target=\{external \? '_blank'/s);
    assert.match(source, /noopener noreferrer/);
  }
});

test('public News and Blog pages do not expose an admin-style type switch', () => {
  assert.doesNotMatch(newsPage, /NewsTypeSwitch|>NEWS<|>BLOG</);
  assert.doesNotMatch(blogPage, /NewsTypeSwitch|>NEWS<|>BLOG</);
});
