'use client';

export default function RevenueError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="flex-1 p-8"><h1 className="text-2xl font-semibold">Membership revenue</h1><div className="mt-6 rounded-lg border p-5" role="alert"><p>We could not load the revenue report.</p><button className="mt-3 rounded-md border px-3 py-2 text-sm" onClick={reset} type="button">Try again</button></div></main>;
}
