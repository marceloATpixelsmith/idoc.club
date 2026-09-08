'use client';

export default function ErrorState({ reset }: { error: Error & { digest?: string }; reset: () => void }) { return <main className="space-y-4 px-5 py-8 lg:px-8"><h1 className="text-2xl font-semibold">This administration area is unavailable</h1><p className="text-muted-foreground">The request could not be completed. No changes were made.</p><button className="rounded bg-primary px-4 py-2 text-primary-foreground" onClick={reset} type="button">Try again</button></main>; }
