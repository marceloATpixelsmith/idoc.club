import type { NextConfig } from 'next';

const baseSecurityHeaders = [
  // Browsers only honor Strict-Transport-Security on a response actually received over HTTPS,
  // so this is safe to emit unconditionally (a plain-HTTP local dev response is simply ignored).
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' }
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Every route denies geolocation/camera/microphone by default, except /dashboard below --
        // the page that hosts onboarding and requests the browser's current position as a best-effort ranking hint
        // for address autocomplete (see onboarding-wizard.tsx). A single shared Permissions-Policy
        // matching every route would otherwise make that request silently rejected by the browser
        // before the page ever gets a chance to use it.
        source: '/(.*)',
        headers: [...baseSecurityHeaders, { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }]
      },
      {
        source: '/dashboard',
        headers: [...baseSecurityHeaders, { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' }]
      }
    ];
  },
  async redirects() {
    return [
      {
        destination: '/dashboard/security',
        permanent: true,
        source: '/dashboard/activity'
      }
    ];
  }
};

export default nextConfig;
