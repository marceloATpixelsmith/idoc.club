import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// AUTH-PRIVACY-001: "Authentication data MUST be minimized, purpose-limited, access-controlled,
// tenant-isolated, bounded for retention/export, and excluded from unrestricted analytics." Access
// control and purpose-limited export are already proven in tests/authorization-boundary-inventory
// .test.ts; tenant isolation is trivial (this deployment is single-tenant); bounded export is
// proven behaviorally in tests/exports.integration.ts. "Excluded from unrestricted analytics" has
// no dedicated mechanism to test because there is no analytics integration in this codebase at all
// -- satisfied by absence, not by a designed control. That absence is what this file actually
// proves, against the real dependency manifest and the one file (the root layout, which wraps every
// page) where a site-wide tracker would have to be wired in to reach authentication pages at all.

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
const rootLayout = readFileSync('app/layout.tsx', 'utf8');

const ANALYTICS_PACKAGE_PATTERN = /analytics|gtag|ga4|mixpanel|amplitude|posthog|hotjar|fullstory|segment|plausible|hubspot|mixpanel/i;
const ANALYTICS_MARKUP_PATTERN = /google-analytics\.com|googletagmanager\.com|analytics\.js|gtag\(|mixpanel|amplitude|posthog|hotjar|fullstory|segment\.io|plausible\.io|hubspot/i;

test('no analytics/tracking SDK is declared as a project dependency', () => {
  const declared = { ...packageJson.dependencies, ...packageJson.devDependencies };
  for (const name of Object.keys(declared)) {
    assert.doesNotMatch(name, ANALYTICS_PACKAGE_PATTERN, `${name} looks like an analytics/tracking dependency`);
  }
});

test('the root layout -- which every page, including every authentication page, renders through -- embeds no analytics/tracking script or call', () => {
  assert.doesNotMatch(rootLayout, ANALYTICS_MARKUP_PATTERN);
});
