/**
 * Diagnostic for Vercel configuration. Never prints connection strings,
 * passwords, hostnames, or other environment variable values.
 *
 * Usage: node scripts/diagnose-postgres-url.mjs
 */
const value = process.env.POSTGRES_URL;
let parsed;
try {
  if (value) parsed = new URL(value);
} catch {
  // Invalid URL; report only boolean diagnostics below.
}

const requiredUsername = process.env.VERCEL_ENV === 'production'
  ? 'idoc_production_app'
  : process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_GIT_COMMIT_REF === 'staging'
    ? 'idoc_staging_app'
    : null;

const checks = {
  present: typeof value === 'string' && value.trim().length > 0,
  urlValid: Boolean(parsed),
  protocolValid: parsed ? ['postgres:', 'postgresql:'].includes(parsed.protocol) : false,
  hostnamePresent: Boolean(parsed?.hostname),
  usernameMatchesEnvironment: requiredUsername ? parsed?.username === requiredUsername : null,
  databaseMatches: parsed ? parsed.pathname === '/ayni_space' : false,
  passwordPresent: Boolean(parsed?.password),
  surroundingWhitespace: typeof value === 'string' ? value !== value.trim() : null,
};

console.log('POSTGRES_URL_SANITIZED_DIAGNOSTIC', JSON.stringify(checks));
if (!checks.present || !checks.urlValid || !checks.protocolValid || !checks.hostnamePresent || checks.usernameMatchesEnvironment === false) {
  process.exitCode = 1;
}
