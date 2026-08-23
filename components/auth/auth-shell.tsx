import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';

const visualStyle: CSSProperties = {
  backgroundImage: 'url(/auth-background.jpg)',
  backgroundPosition: 'calc(50% + 150px) center',
  backgroundSize: 'cover',
};

/** IDOC-branded implementation of the canonical Pixelsmith AuthShell geometry and responsive
 * behavior. Only branding assets/text are IDOC-specific; layout and legal placement follow the
 * reference shell. */
export function AuthShell({ children, description, title, wide }: { children: ReactNode; description?: ReactNode; title: string; wide?: boolean }) {
  return (
    <main className="flex min-h-screen flex-col bg-white md:flex-row">
      <section
        aria-hidden="true"
        className="order-2 h-[220px] w-full shrink-0 overflow-hidden bg-cover md:min-h-screen md:h-auto md:w-1/2"
        style={visualStyle}
      />

      <section className="order-1 flex w-full items-center justify-center bg-white px-5 py-8 md:min-h-screen md:w-1/2 md:px-8">
        <div className={`flex w-full flex-col items-center gap-5 ${wide ? 'max-w-2xl' : 'max-w-[400px]'}`}>
          <header className="flex w-full items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- canonical auth branding asset */}
            <img alt="IDOC" className="h-14 w-auto object-contain" src="/idoc-logo.svg" />
          </header>

          <div className="w-full">
            <h1 className="mb-2 text-center text-2xl font-bold text-gray-900 sm:text-3xl">{title}</h1>
            {description ? <p className="mb-6 text-center text-sm text-gray-600">{description}</p> : null}
            <div className={description ? '' : 'mt-6'}>{children}</div>
          </div>

          <footer className="w-full text-center text-xs leading-5 text-gray-500">
            By continuing, you agree to our{' '}
            <Link className="font-medium text-gray-700 no-underline hover:underline" href="/terms">Terms of Service</Link>{' '}
            and{' '}
            <Link className="font-medium text-gray-700 no-underline hover:underline" href="/privacy">Privacy Policy</Link>.
          </footer>
        </div>
      </section>
    </main>
  );
}
