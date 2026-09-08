import Link from 'next/link';
import type { ReactNode } from 'react';

export function HeaderShell({
  right,
  below,
  onLogoClick
}: {
  right: ReactNode;
  below?: ReactNode;
  onLogoClick?: () => void;
}) {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-24 max-w-7xl items-center justify-between gap-6 px-5 lg:px-8">
        <Link href="/" className="flex items-center gap-3" onClick={onLogoClick}>
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
          <img src="/idoc-logo.svg" alt="IDOC — International Dressage Officials Club" className="h-14 w-auto" />
        </Link>
        {right}
      </div>
      {below}
    </header>
  );
}
