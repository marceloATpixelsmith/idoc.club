import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const expectedVersion = packageJson.packageManager?.match(/^pnpm@(\d+\.\d+\.\d+)$/)?.[1];

if (!expectedVersion) {
  throw new Error('package.json must declare an exact packageManager value such as pnpm@10.28.1.');
}

const workflowNames = [
  '.github/workflows/fast-pr-verification.yml',
  '.github/workflows/auth-security-verification.yml',
  '.github/workflows/release-1-verification.yml',
];

for (const workflowName of workflowNames) {
  const workflow = await readFile(new URL(workflowName, root), 'utf8');
  const versions = [...workflow.matchAll(/version:\s*(?:[{'\" ]*)?([0-9]+\.[0-9]+\.[0-9]+)/g)].map((match) => match[1]);
  if (!versions.includes(expectedVersion)) {
    throw new Error(`${workflowName} must install pnpm ${expectedVersion}.`);
  }
}

const fastWorkflow = await readFile(
  new URL('.github/workflows/fast-pr-verification.yml', root),
  'utf8'
);
const securityWorkflow = await readFile(
  new URL('.github/workflows/auth-security-verification.yml', root),
  'utf8'
);
const releaseWorkflow = await readFile(
  new URL('.github/workflows/release-1-verification.yml', root),
  'utf8'
);

export function hasBlockingHighAudit(workflow) {
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const auditLine = lines[index];
    const match = auditLine.match(/^(\s*)- run:\s*pnpm audit --audit-level=high\s*$/);
    if (!match) continue;
    const stepIndent = match[1].length;
    const stepLines = [auditLine];
    for (let next = index + 1; next < lines.length; next += 1) {
      const line = lines[next];
      if (line.trim() !== '' && line.length - line.trimStart().length <= stepIndent) break;
      stepLines.push(line);
    }
    const step = stepLines.join('\n');
    if (!/^\s*continue-on-error\s*:/m.test(step)) return true;
  }
  return false;
}

if (!hasBlockingHighAudit(fastWorkflow)) {
  throw new Error('Fast PR CI must block on high-severity dependency advisories.');
}
if (hasBlockingHighAudit(securityWorkflow) || hasBlockingHighAudit(releaseWorkflow)) {
  throw new Error('High-severity dependency audit must run only in Fast PR CI, not be repeated in full workflows.');
}

console.log(`Toolchain policy valid: pnpm ${expectedVersion}; the fast workflow runs the single blocking high-severity audit.`);
