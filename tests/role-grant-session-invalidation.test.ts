import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const source = readFileSync(path.join(process.cwd(), 'lib/membership/role-grants.ts'), 'utf8');

test('privileged role changes invalidate the target account sessions inside the transaction', () => {
  assert.match(source, /requireSuperAdmin\(actor\)/);
  const invalidations = [...source.matchAll(/sessionVersion:\s*sql`\$\{users\.sessionVersion\} \+ 1`/g)];
  assert.equal(invalidations.length, 2, 'both grant and revoke must increment the target session version');
  assert.match(source, /action: 'admin\.role\.granted'/);
  assert.match(source, /action: 'admin\.role\.revoked'/);
});
