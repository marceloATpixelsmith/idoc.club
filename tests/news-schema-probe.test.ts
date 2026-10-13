import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// The deployed schemas are idoc_staging and idoc_production; the legacy `idoc` schema does not exist. A catalog
// probe that names `idoc` always answers "not ready" and silently selects the legacy news query (no audience filter).
test('news schema probes inspect the connection schema, not the legacy schema name', () => {
  const source = readFileSync('lib/news/articles.ts', 'utf8');
  assert.equal(/table_schema\s*=\s*'idoc'/.test(source), false);
  const probes = source.match(/table_schema=current_schema\(\)/g) ?? [];
  assert.equal(probes.length, 4);
  assert.match(source, /function cacheWhenReady/);
  for (const name of ['newsSchemaSupportsTypeAndThumbnail', 'newsSchemaSupportsAudience', 'newsSchemaSupportsExternalUrl']) {
    assert.match(source, new RegExp(`const ${name} = cacheWhenReady\\(`));
  }
});
