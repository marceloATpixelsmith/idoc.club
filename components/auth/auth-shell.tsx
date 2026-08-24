import Link from 'next/link';
import type { ReactNode } from 'react';
import './canonical-reference.css';

export function AuthShell({
  children,
  description,
  title,
  wide,
}: {
  children: ReactNode;
  description?: ReactNode;
  title?: string;
  wide?: boolean;
}) {
  const hasHeading = Boolean(title || description);

  return (
    <main className="idoc-auth-shell">
      <section aria-hidden="true" className="idoc-auth-shell__visual" />

      <section className="idoc-auth-shell__content">
        <div className={`idoc-auth-shell__inner${wide ? ' idoc-auth-shell__inner--wide' : ''}`}>
          <header className="idoc-auth-shell__header">
            {/* eslint-disable-next-line @next/next/no-img-element -- canonical auth branding asset */}
            <img alt="IDOC" className="idoc-auth-shell__logo" src="/idoc-logo.svg" />
          </header>

          <div className="idoc-auth-shell__page">
            <div className="idoc-auth-page">
              {hasHeading ? (
                <div className="idoc-auth-page__heading">
                  {title ? <h1 className="idoc-auth-page__title">{title}</h1> : null}
                  {description ? <div className="idoc-auth-page__instructions">{description}</div> : null}
                </div>
              ) : null}
              {children}
            </div>
          </div>

          <footer className="idoc-auth-shell__legal">
            By continuing, you agree to our{' '}
            <Link href="/terms">Terms of Service</Link>{' '}
            and{' '}
            <Link href="/privacy">Privacy Policy</Link>.
          </footer>
        </div>
      </section>
    </main>
  );
}
