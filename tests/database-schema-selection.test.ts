import assert from 'node:assert/strict';
import test from 'node:test';
import { getDatabaseSchemaName } from '../lib/db/schema-name.ts';

test('legacy schema remains default during preparation', () => {
  const previous = process.env.DB_SCHEMA;
  try {
    delete process.env.DB_SCHEMA;
    assert.equal(getDatabaseSchemaName(), 'idoc');
  } finally {
    if (previous === undefined) delete process.env.DB_SCHEMA;
    else process.env.DB_SCHEMA = previous;
  }
});

test('schema selector rejects invalid names', () => {
  const previous = process.env.DB_SCHEMA;
  try {
    process.env.DB_SCHEMA = 'public';
    assert.throws(() => getDatabaseSchemaName(), /Unexpected DB_SCHEMA/);
  } finally {
    if (previous === undefined) delete process.env.DB_SCHEMA;
    else process.env.DB_SCHEMA = previous;
  }
});
