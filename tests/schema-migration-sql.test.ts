import assert from 'node:assert/strict';
import test from 'node:test';
import { rewriteMigrationSql } from '../scripts/schema-migration-sql.mjs';

test('historical migration SQL is rewritten only for quoted database schema identifiers', () =>
{
    const source = [
        'CREATE SCHEMA IF NOT EXISTS "idoc";',
        'CREATE TABLE "idoc"."users" ("id" serial primary key);',
        'select \'https://idoc.club/dashboard\';',
        "select set_config('idoc.allow_member_permanent_delete','on',true);",
    ].join('\n');

    const rewritten = rewriteMigrationSql(source, 'idoc_staging');

    assert.match(rewritten, /CREATE SCHEMA IF NOT EXISTS "idoc_staging"/);
    assert.match(rewritten, /CREATE TABLE "idoc_staging"\."users"/);
    assert.match(rewritten, /https:\/\/idoc\.club\/dashboard/);
    assert.match(rewritten, /idoc\.allow_member_permanent_delete/);
    assert.doesNotMatch(rewritten, /"idoc"\s*\./);
});

test('migration SQL rewriter rejects arbitrary schemas', () =>
{
    assert.throws(() => rewriteMigrationSql('select 1;', 'public'), /Unsupported migration schema/);
});
