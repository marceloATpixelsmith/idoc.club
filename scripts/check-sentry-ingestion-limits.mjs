#!/usr/bin/env node
/**
 * Audit (or explicitly apply) provider-side Sentry project client-key caps.
 * Browser-side SDK filtering cannot protect the public DSN against direct ingestion abuse.
 * Never log response JSON or DSNs: Sentry key listings contain public and secret material.
 *
 * Required: SENTRY_SECURITY_AUTH_TOKEN (project:read, plus project:write for --apply).
 * Defaults target the dedicated IDOC project, never other Sentry projects.
 */
const organization = process.env.SENTRY_ORG ?? 'pixelsmith-platform';
const project = process.env.SENTRY_PROJECT ?? 'idoc';
const token = process.env.SENTRY_SECURITY_AUTH_TOKEN;
const maxCount = Number(process.env.SENTRY_KEY_MAX_EVENTS ?? 1000);
const windowSeconds = Number(process.env.SENTRY_KEY_WINDOW_SECONDS ?? 3600);
const apply = process.argv.includes('--apply');
if (!token) {
  console.error('SENTRY_SECURITY_AUTH_TOKEN is required to verify Sentry provider-side key limits.');
  process.exit(2);
}
if (!Number.isInteger(maxCount) || maxCount < 1 || maxCount > 10000 ||
    !Number.isInteger(windowSeconds) || windowSeconds < 60 || windowSeconds > 86400) {
  console.error('Invalid key limit policy. Check SENTRY_KEY_MAX_EVENTS and SENTRY_KEY_WINDOW_SECONDS.');
  process.exit(2);
}
const root = 'https://sentry.io/api/0/projects/' +
  encodeURIComponent(organization) + '/' + encodeURIComponent(project) + '/keys/';
async function request(url, method = 'GET', body) {
  const response = await fetch(url, {
    method,
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('Sentry API returned HTTP ' + response.status +
    ' for ' + method + '. Verify token project permissions and project slug.');
  return response.json();
}
try {
  const keys = await request(root);
  if (!Array.isArray(keys)) throw new Error('Unexpected response from Sentry client keys API');
  const active = keys.filter((key) => key.isActive !== false);
  if (active.length === 0) throw new Error('No active Sentry client keys found.');
  let failures = 0;
  for (const key of active) {
    const current = key.rateLimit;
    const valid = current && Number.isInteger(current.count) &&
      Number.isInteger(current.window) &&
      current.window > 0 && current.count > 0 &&
      current.count * windowSeconds <= maxCount * current.window;
    if (valid) {
      console.log('Sentry client key ' + key.id + ': protected (' +
        current.count + ' per ' + current.window + ' seconds).');
      continue;
    }
    if (!apply) {
      failures++;
      console.error('Sentry client key ' + key.id + ': no adequate provider-side event cap configured.');
      continue;
    }
    await request(root + encodeURIComponent(String(key.id)) + '/', 'PUT',
      { rateLimit: { count: maxCount, window: windowSeconds } });
    console.log('Sentry client key ' + key.id + ': applied rate cap.');
  }
  if (failures) {
    console.error('Sentry ingestion key audit failed for ' + failures +
      ' active keys. Review Sentry Settings > Projects > idoc > Client Keys or rerun with --apply.');
    process.exitCode = 1;
  } else {
    if (apply) {
      console.log('Re-reading Sentry provider settings after applying limits...');
      const check = await request(root);
      if (!Array.isArray(check) || check.filter((k) => k.isActive !== false).some((k) =>
        !k.rateLimit || !(k.rateLimit.count * windowSeconds <= maxCount * k.rateLimit.window))) {
        throw new Error('Sentry did not persist an adequate limit for every active key.');
      }
    }
    console.log('All active Sentry client keys have a provider-side ingestion cap.');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Sentry ingestion limit audit failed.');
  process.exitCode = 1;
}
