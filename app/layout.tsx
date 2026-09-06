import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Archivo, Barlow } from 'next/font/google';
import { getPublicUser } from '@/lib/db/queries';
import { currentCsrfToken } from '@/lib/security/csrf';
import { CsrfProvider } from '@/components/security/csrf-provider';
import { SWRConfig } from 'swr';

const archivo = Archivo({
  subsets: ['latin'],
  variable: '--font-archivo',
  display: 'swap'
});

const barlow = Barlow({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-barlow',
  display: 'swap'
});

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
      className={`${archivo.variable} ${barlow.variable} bg-background font-sans text-foreground`}
    >
      <body className="min-h-[100dvh] bg-background">
        <CsrfProvider token={csrfToken}>
          <SWRConfig
            value={{
              fallback: {
                // We do NOT await here
                // Only components that read this data will suspend
                //
                // AUTH-API-003: this MUST resolve to the same minimized shape /api/user itself
                // returns (getPublicUser(), never the raw getUser() row) -- whatever this promise
                // resolves to is serialized into the RSC payload embedded in every authenticated
                // page's initial HTML response, not merely into a same-origin fetch response, so an
                // unminimized fallback here would leak passwordHash and other server-only fields to
                // every page's page source regardless of what the API route itself returns.
                '/api/user': getPublicUser()
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
