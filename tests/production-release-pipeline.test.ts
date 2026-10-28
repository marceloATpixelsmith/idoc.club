import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const release = readFileSync('.github/workflows/monitored-production-promotion.yml', 'utf8');
const recovery = readFileSync('.github/workflows/auto-migrate-production.yml', 'utf8');
const runner = readFileSync('scripts/monitored-production-promotion.mjs', 'utf8');
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));

test('production deploys only through the guarded promotion pipeline', () =>
{
    assert.equal(vercel.git.deploymentEnabled.main, false);
    assert.equal(vercel.git.deploymentEnabled.staging, true);
    assert.match(release, /environment: idoc-db-production-maintenance/);
    assert.match(release, /workflow_dispatch:/);
    assert.doesNotMatch(release, /\n  push:\n/);
    assert.doesNotMatch(recovery, /\n  push:\n/);
});

test('release order enforces backup, schema readiness, deployment and health', () =>
{
    const steps = [
        'Check PR, reviews, staging and all required CI gates',
        'Merge verified promotion PR into main',
        'Check out the exact merged production commit',
        'Mandatory IDOC offsite pre-migration backup',
        'Guard - bind to the backed-up server',
        'Apply every pending committed migration to idoc_production',
        'Verify the ledger reached the newest committed migration',
        'Trigger production deploy only after schema verification succeeds',
        'Verify Vercel production deployment of exact merge commit',
        'Verify production health',
    ];
    let position = -1;
    for (const step of steps)
    {
        const next = release.indexOf(step);
        assert.ok(next > position, 'Required release step is missing or out of order: ' + step);
        position = next;
    }
    assert.match(release, /ref: \$\{\{ steps\.merge\.outputs\.merge_sha \}\}/);
    assert.match(release, /PROMOTION_TRIGGERED_AT: \$\{\{ steps\.trigger\.outputs\.triggered_at \}\}/);
});

test('promotion verifies an exact commit and ignores stale Vercel failures', () =>
{
    assert.match(runner, /main\.commit\.sha !== sha/);
    assert.match(runner, /DEPLOY_HOOK/);
    assert.match(runner, /triggered_at=/);
    assert.match(runner, /Date\.parse\(item\.created_at\) >= triggeredAt/);
    assert.match(runner, /Vercel success status does not belong to the expected project/);
});
