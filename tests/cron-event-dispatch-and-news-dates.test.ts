import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

test('cancellation dispatches immediately after database commit in both admin paths', () => {
  const drawer = read('lib/seminars/seminars.ts');
  const inline = read('app/(dashboard)/admin/bulk-actions.ts');
  for (const source of [drawer, inline]) {
    assert.match(source, /needsCancellationResolution = true;/);
    assert.match(source, /if \(needsCancellationResolution\) dispatchQueuedEmailAfterResponse\(\(\) => processCanceledSeminarPayments\(\), 'seminar-cancellation-resolution'\);/);
  }
});

test('date-only publishing is normalized to midnight UTC and runs once daily', () => {
  const form = read('app/(dashboard)/admin/news/news-drawer.tsx');
  assert.doesNotMatch(form, /datetime-local/);
  assert.match(form, /name="publicationDate" required type="date"/);
  const articles = read('lib/news/articles.ts');
  assert.match(articles, /T00:00:00\.000/);
  assert.match(articles, /publication_date at time zone 'UTC'/);
  assert.match(articles, /publication_date=\(\(publication_date at time zone 'UTC'\)/);
  assert.match(articles, /\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$/);
  const schedules = JSON.parse(read('vercel.json')) as { crons: { path: string; schedule: string }[] };
  assert.equal(schedules.crons.find((entry) => entry.path === '/api/cron/news-scheduled-publish')?.schedule, '0 0 * * *');
  assert.equal(schedules.crons.find((entry) => entry.path === '/api/cron/seminar-cancellation-resolution')?.schedule, '0 * * * *');
});
