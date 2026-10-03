import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('lib/news/articles.ts', 'utf8');
const actions = readFileSync('app/(dashboard)/admin/news/actions.ts', 'utf8');

test('News and Blog reads stay compatible when migration 0064 columns are not present yet', () => {
  assert.match(source, /newsSchemaSupportsTypeAndThumbnail/);
  assert.match(source, /information_schema\.columns/);
  assert.match(source, /legacyArticleTypeSql/);
  assert.match(source, /legacyThumbnailSql/);
  assert.match(source, /schemaReady[\s\S]*?thumbnail_url/);
  assert.match(source, /res\.cloudinary\.com\/z6xv27qx/);
});

test('admin writes self-heal the additive News Blog schema before upload when 0064 or 0065 is missing', () => {
  assert.match(source, /export async function requireNewsArticleSchema/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /add column if not exists article_type/);
  assert.match(source, /add column if not exists thumbnail_url/);
  assert.match(source, /add column if not exists external_url/);
  assert.match(source, /create index if not exists news_articles_type_publication_idx/);
  assert.match(actions, /await requireNewsArticleSchema\(\);[\s\S]*?resolveNewsThumbnail/);
});
