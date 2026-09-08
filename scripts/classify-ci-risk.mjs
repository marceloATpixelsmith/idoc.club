import { execFileSync } from 'node:child_process';

const base = process.env.GITHUB_BASE_SHA || process.argv[2];
const head = process.env.GITHUB_SHA || 'HEAD';
if (!base) throw new Error('CI risk classification requires GITHUB_BASE_SHA or a base SHA argument.');

const files = execFileSync('git', ['diff', '--name-only', `${base}...${head}`], { encoding: 'utf8' })
  .split('\n').map((file) => file.trim()).filter(Boolean);

const securityPatterns = [
  /^app\/\(login\)\//,
  /^app\/api\/auth\//,
  /^app\/\(dashboard\)\/dashboard\/security\//,
  /^app\/\(dashboard\)\/admin\/security\//,
  /^components\/turnstile-widget\.tsx$/,
  /^lib\/auth\//,
  /^lib\/security\//,
  /^lib\/runtime\/configuration\.ts$/,
  /^lib\/membership\/authorization\.ts$/,
  /^middleware\.ts$/,
  /^next\.config\.ts$/,
  /^tests\/security-e2e\//,
  /^tests\/.*(?:auth|security).*\.(?:ts|tsx|mjs)$/i,
];

const lowRiskPatterns = [
  /^docs\//,
  /^public\//,
  /\.md$/i,
  /\.css$/i,
  /\.(?:svg|png|jpg|jpeg|gif|webp)$/i,
  /^components\/navigation-loading\.tsx$/,
  /^components\/navigation-menu\.tsx$/,
];

const securityFiles = files.filter((file) => securityPatterns.some((pattern) => pattern.test(file)));
const nonLowRiskFiles = files.filter((file) => !lowRiskPatterns.some((pattern) => pattern.test(file)));
const requiresSecurity = securityFiles.length > 0;
const requiresRelease = nonLowRiskFiles.length > 0;
const category = requiresSecurity ? 'security' : requiresRelease ? 'release' : 'low';

const result = { category, files, requiresRelease, requiresSecurity, securityFiles };
console.log(JSON.stringify(result, null, 2));

if (process.env.GITHUB_STEP_SUMMARY) {
  const summary = [
    '## CI risk classification',
    '',
    `- Classification: **${category}**`,
    `- Release 1 verification: **${requiresRelease ? 'required' : 'not required'}**`,
    `- Authentication security verification: **${requiresSecurity ? 'required' : 'not required'}**`,
    '',
    'Security-triggering files:',
    ...(securityFiles.length ? securityFiles.map((file) => `- \`${file}\``) : ['- None']),
  ].join('\n');
  await import('node:fs/promises').then(({ appendFile }) => appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`));
}
