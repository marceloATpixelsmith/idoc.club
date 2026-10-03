import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const articleView = readFileSync('components/news/article-view.tsx', 'utf8');
const blogPage = readFileSync('app/(marketing)/blog/[slug]/page.tsx', 'utf8');
const newsPage = readFileSync('app/(marketing)/news/[slug]/page.tsx', 'utf8');

test('news and blog details fill the available content width and return to their listings', () => {
  assert.match(articleView, /<article className="w-full px-5 py-12 lg:px-8">/);
  assert.doesNotMatch(articleView, /mx-auto max-w-3xl/);
  assert.match(newsPage, /backHref="\/news"/);
  assert.match(blogPage, /backHref="\/blog"/);
});
