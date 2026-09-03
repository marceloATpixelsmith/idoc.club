import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

// AUTH-PRIVACY-001: "Authentication data MUST be minimized, purpose-limited, access-controlled,
// tenant-isolated, bounded for retention/export, and excluded from unrestricted analytics." Access
// control and purpose-limited export are already proven in tests/authorization-boundary-inventory
// .test.ts; tenant isolation is trivial (this deployment is single-tenant); bounded export is
// proven behaviorally in tests/exports.integration.ts. "Excluded from unrestricted analytics" has
// no dedicated mechanism to test because there is no analytics integration in this codebase at all
// -- satisfied by absence, not by a designed control. That absence is what this file actually
// proves, against the real dependency manifest and every production source file under app/ and
// lib/ (not merely the root layout) -- a site-wide tracker could equally be wired into a nested
// layout, a specific page, a shared client component, or middleware.ts, so the scan was broadened
// from a single file to the complete production source tree following a Codex audit finding. The
// real production *build output* is additionally scanned in tests/build-runtime-boundary.build.ts,
// which catches anything a transitive dependency might bundle in even if no source file references
// it directly.

const root = process.cwd();
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

const ANALYTICS_PACKAGE_PATTERN = /analytics|gtag|ga4|mixpanel|amplitude|posthog|hotjar|fullstory|segment|plausible|hubspot|mixpanel/i;
const ANALYTICS_MARKUP_PATTERN = /google-analytics\.com|googletagmanager\.com|analytics\.js|gtag\(|mixpanel|amplitude|posthog|hotjar|fullstory|segment\.io|plausible\.io|hubspot/i;

function sourceFilesBelow(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return [];
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFilesBelow(file);
    return /\.(?:ts|tsx|js|jsx)$/.test(entry.name) ? [file] : [];
  });
}

const productionSourceFiles = [
  ...sourceFilesBelow(path.join(root, 'app')),
  ...sourceFilesBelow(path.join(root, 'lib')),
  path.join(root, 'middleware.ts'),
  path.join(root, 'next.config.ts'),
].filter((file) => existsSync(file));

test('no analytics/tracking SDK is declared as a project dependency', () => {
  const declared = { ...packageJson.dependencies, ...packageJson.devDependencies };
  for (const name of Object.keys(declared)) {
    assert.doesNotMatch(name, ANALYTICS_PACKAGE_PATTERN, `${name} looks like an analytics/tracking dependency`);
  }
});

test('no production source file under app/ or lib/ (nor middleware.ts/next.config.ts) embeds an analytics/tracking script or call', () => {
  assert.ok(productionSourceFiles.length > 50, 'expected a substantial production source tree to scan');
  for (const file of productionSourceFiles) {
    const content = readFileSync(file, 'utf8');
    assert.doesNotMatch(content, ANALYTICS_MARKUP_PATTERN, `${path.relative(root, file)} appears to embed an analytics/tracking reference`);
  }
});
