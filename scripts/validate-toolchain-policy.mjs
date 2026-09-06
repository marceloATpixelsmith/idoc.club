import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const expectedVersion = packageJson.packageManager?.match(/^pnpm@(\d+\.\d+\.\d+)$/)?.[1];

if (!expectedVersion) {
  throw new Error('package.json must declare an exact packageManager value such as pnpm@10.28.1.');
}

const workflowNames = [
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

const securityWorkflow = await readFile(
  new URL('.github/workflows/auth-security-verification.yml', root),
  'utf8'
);
const blockingAudit = /^\s+- run: pnpm audit --audit-level=high\s*$/m;
if (!blockingAudit.test(securityWorkflow)) {
  throw new Error('Authentication security CI must run blocking pnpm audit --audit-level=high.');
}
if (/pnpm audit --audit-level=high[^\n]*(?:\|\||continue-on-error)/.test(securityWorkflow)) {
  throw new Error('Authentication security CI must not bypass high-severity audit failures.');
}

console.log(`Toolchain policy valid: pnpm ${expectedVersion}; high-severity audit is blocking.`);
