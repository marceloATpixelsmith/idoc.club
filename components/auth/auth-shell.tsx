import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';

/** Shared shell for every signup/login/password-reset screen: IDOC logo + step title on a plain
 * white panel (so form content, focus states, and error text are never fighting the background
 * image for contrast), a full-bleed brand photo on the other half, and the standard legal footer.
 * Hidden below lg so the form gets the full viewport width on small screens. */
export function AuthShell({ children, description, title }: { children: ReactNode; description?: ReactNode; title: string }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex items-center justify-center px-6 py-12 sm:px-12">
        <div className="w-full max-w-md">
          {/* eslint-disable-next-line @next/next/no-img-element -- static SVG mark, not a photo */}
          <img alt="IDOC" className="mb-8 h-14 w-auto" src="/idoc-logo.svg" />
          <h1 className="mb-2 text-2xl font-bold text-gray-900 sm:text-3xl">{title}</h1>
          {description ? <p className="mb-6 text-sm text-gray-600">{description}</p> : null}
          <div className={description ? '' : 'mt-6'}>{children}</div>
          <p className="mt-8 text-center text-xs text-gray-500">
            By signing in, you agree to our{' '}
            <Link className="underline hover:text-gray-700" href="/terms">Terms of Service</Link> and{' '}
            <Link className="underline hover:text-gray-700" href="/privacy">Privacy Policy</Link>.
          </p>
        </div>
      </div>
      <div className="relative hidden lg:block">
        <Image alt="" className="object-cover" fill priority sizes="50vw" src="/auth-background.jpg" />
      </div>
    </div>
  );
}
