import Link from 'next/link';
import { Home } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-5 py-16">
      <div className="w-full max-w-lg rounded-3xl border border-border bg-card px-6 py-12 text-center shadow-sm sm:px-12">
        <div className="mx-auto mb-7 flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
          <span className="font-display text-2xl font-semibold">404</span>
        </div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-primary">IDOC</p>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">We couldn&apos;t find that page</h1>
        <p className="mx-auto mt-4 max-w-sm text-base leading-7 text-muted-foreground">
          The address may be incorrect, or the page may have moved. You can return to the IDOC home page and continue from there.
        </p>
        <Link href="/" className="mx-auto mt-8 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90">
          <Home className="size-4" />
          Back to home
        </Link>
      </div>
    </div>
  );
}
