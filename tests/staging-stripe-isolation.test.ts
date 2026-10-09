import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the Stripe server client refuses live credentials when staging schema is selected', async () => {
  const source = await readFile('lib/payments/stripe-client.ts', 'utf8');
  assert.match(source, /getDatabaseSchemaName\(\) === 'idoc_staging' && liveClient/);
  assert.match(source, /Refusing live Stripe credentials while DB_SCHEMA is idoc_staging/);
});
