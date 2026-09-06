import type { NextConfig } from 'next';

const baseSecurityHeaders = [
  { key: 'Content-Security-Policy', value: "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com" },
  // Browsers only honor Strict-Transport-Security on a response actually received over HTTPS,
  // so this is safe to emit unconditionally (a plain-HTTP local dev response is simply ignored).
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' }
];

const nextConfig: NextConfig = {
  experimental: {
    ppr: true,
    clientSegmentCache: true
  },
  async headers() {
    return [
      {
        // Every route denies geolocation/camera/microphone by default, except /onboarding below --
        // the one page that requests the browser's current position, as a best-effort ranking hint
        // for address autocomplete (see onboarding-wizard.tsx). A single shared Permissions-Policy
        // matching every route would otherwise make that request silently rejected by the browser
        // before the page ever gets a chance to use it.
        source: '/:path((?!onboarding$).*)',
        headers: [...baseSecurityHeaders, { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }]
      },
      {
        source: '/onboarding',
        headers: [...baseSecurityHeaders, { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' }]
      }
    ];
  }
};

export default nextConfig;
