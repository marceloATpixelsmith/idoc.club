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

test('writes that require article_type or thumbnail_url fail before upload when 0064 is missing', () => {
  assert.match(source, /export async function requireNewsArticleSchema/);
  assert.match(source, /database migration 0064 is applied/);
  assert.match(actions, /await requireNewsArticleSchema\(\);[\s\S]*?resolveNewsThumbnail/);
});
