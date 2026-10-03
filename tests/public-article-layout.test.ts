import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const articleView = readFileSync('components/news/article-view.tsx', 'utf8');
const blogPage = readFileSync('app/(marketing)/blog/[slug]/page.tsx', 'utf8');
const newsPage = readFileSync('app/(marketing)/news/[slug]/page.tsx', 'utf8');
const newsListingPage = readFileSync('app/(marketing)/news/page.tsx', 'utf8');
const homepage = readFileSync('app/(marketing)/page.tsx', 'utf8');

test('news and blog details fill the available content width and return to their listings', () => {
  assert.match(articleView, /<article className="mx-auto w-full max-w-7xl px-5 py-12 lg:px-8">/);
  assert.match(articleView, /aspect-\[16\/9\] w-full max-w-3xl rounded-lg/);
  assert.doesNotMatch(articleView, /mx-auto max-w-3xl/);
  assert.match(newsPage, /backHref="\/news"/);
  assert.match(blogPage, /backHref="\/blog"/);
  assert.match(newsListingPage, /grid grid-cols-1 gap-8 md:grid-cols-2/);
  assert.match(homepage, /className="mt-10 flex flex-col gap-6"/);
});
