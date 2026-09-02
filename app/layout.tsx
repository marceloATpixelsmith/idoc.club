import './globals.css';
import type { Metadata, Viewport } from 'next';
import { getUser } from '@/lib/db/queries';
import { currentCsrfToken } from '@/lib/security/csrf';
import { CsrfProvider } from '@/components/security/csrf-provider';
import { SWRConfig } from 'swr';

export const metadata: Metadata = {
  title: 'IDOC',
  description: 'IDOC membership platform.'
};

export const viewport: Viewport = {
  maximumScale: 1
};

export default async function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  // Unlike getUser() below, this is a plain cookie read (no DB round trip), so awaiting it here
  // costs nothing and is required: unlike the SWR fallback, the CsrfProvider value must already be
  // the real token before this Server Component's HTML is produced, not a suspended promise --
  // otherwise a no-JS form submission would carry an empty hidden field. middleware.ts guarantees a
  // valid, correctly session-bound cookie already exists by the time any page renders.
  //
  // Deliberately NOT wrapped in a Suspense boundary to scope this as a smaller PPR dynamic hole:
  // that was tried and reverted (see PR history) because it silently broke a real security
  // invariant. Once *anything* reads a dynamic API (cookies/headers) inside a Suspense boundary,
  // Next may begin streaming the boundary's fallback -- HTTP status 200 -- before deeper content
  // (e.g. a protected page's own authorization check) has run, so a subsequent redirect() thrown
  // from within that boundary can no longer become a real 3xx: it degrades to a client-side-only
  // redirect. Every route shares this root layout, so that would have applied to every protected
  // page's authorization redirect too, not just this one. Confirmed with a real dev-server request:
  // an anonymous GET to /admin returned 200 instead of a redirect once this was Suspense-wrapped.
  // Keeping this synchronous and unwrapped costs the app-wide Partial Prerendering static shell
  // (an experimental, opt-in performance optimization -- see next.config.ts), which is an accepted,
  // explicit tradeoff in favor of guaranteed-correct authorization/CSRF behavior on every request.
  const csrfToken = await currentCsrfToken();
  return (
    <html
      lang="en"
      className="bg-white font-sans text-black dark:bg-gray-950 dark:text-white"
    >
      <body className="min-h-[100dvh] bg-gray-50">
        <CsrfProvider token={csrfToken}>
          <SWRConfig
            value={{
              fallback: {
                // We do NOT await here
                // Only components that read this data will suspend
                '/api/user': getUser()
              }
            }}
          >
            {children}
          </SWRConfig>
        </CsrfProvider>
      </body>
    </html>
  );
}
