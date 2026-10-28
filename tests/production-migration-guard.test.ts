import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('production migration guard accepts staging ahead only with every required migration applied', () => {
    const source = readFileSync('scripts/guard-pending-migrations.mjs', 'utf8');
    const workflow = readFileSync('.github/workflows/auto-migrate-production.yml', 'utf8');

    assert.match(source, /staging < newestCommitted/);
    assert.match(source, /journal\.entries\.filter\(\(entry\) => entry\.idx >= 71\)/);
    assert.match(source, /SELECT created_at FROM idoc_staging\.__drizzle_migrations/);
    assert.match(source, /missing\.length/);
    assert.doesNotMatch(source, /staging !== newestCommitted/);
    assert.match(workflow, /- scripts\/guard-pending-migrations\.mjs/);
    assert.match(workflow, /Mandatory IDOC offsite pre-migration backup/);
    assert.match(workflow, /environment: idoc-db-production-maintenance/);
});
