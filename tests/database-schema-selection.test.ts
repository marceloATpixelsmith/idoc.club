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

test('all preview branches refuse production schema selection', () => {
  const previous = { schema: process.env.DB_SCHEMA, env: process.env.VERCEL_ENV, ref: process.env.VERCEL_GIT_COMMIT_REF };
  try {
    process.env.DB_SCHEMA = 'idoc_production';
    process.env.VERCEL_ENV = 'preview';
    for (const branch of ['staging', 'feature/untrusted-preview']) {
      process.env.VERCEL_GIT_COMMIT_REF = branch;
      assert.throws(() => getDatabaseSchemaName(), /Staging may not use production schema/);
    }
  } finally {
    for (const [key, value] of [['DB_SCHEMA', previous.schema], ['VERCEL_ENV', previous.env], ['VERCEL_GIT_COMMIT_REF', previous.ref]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('production refuses staging schema selection', () =>
{
  const previous = { schema: process.env.DB_SCHEMA, env: process.env.VERCEL_ENV, ref: process.env.VERCEL_GIT_COMMIT_REF };
  try
  {
    process.env.DB_SCHEMA = 'idoc_staging';
    process.env.VERCEL_ENV = 'production';
    process.env.VERCEL_GIT_COMMIT_REF = 'main';
    assert.throws(() => getDatabaseSchemaName(), /Production may not use staging schema/);
  }
  finally
  {
    for (const [key, value] of [['DB_SCHEMA', previous.schema], ['VERCEL_ENV', previous.env], ['VERCEL_GIT_COMMIT_REF', previous.ref]] as const)
    {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('only the staging branch is allowed to use idoc_staging in Preview', () =>
{
  const previous = { schema: process.env.DB_SCHEMA, env: process.env.VERCEL_ENV, ref: process.env.VERCEL_GIT_COMMIT_REF };
  try
  {
    process.env.DB_SCHEMA = 'idoc_staging';
    process.env.VERCEL_ENV = 'preview';
    process.env.VERCEL_GIT_COMMIT_REF = 'staging';
    assert.equal(getDatabaseSchemaName(), 'idoc_staging');
    process.env.VERCEL_GIT_COMMIT_REF = 'feature/some-other-preview';
    assert.throws(() => getDatabaseSchemaName(), /Only the staging branch may use idoc_staging/);
    delete process.env.VERCEL_GIT_COMMIT_REF;
    assert.throws(() => getDatabaseSchemaName(), /Only the staging branch may use idoc_staging/);
  }
  finally
  {
    for (const [key, value] of [['DB_SCHEMA', previous.schema], ['VERCEL_ENV', previous.env], ['VERCEL_GIT_COMMIT_REF', previous.ref]] as const)
    {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
