import { getRevenueReport, RevenueRangeError, type RevenueFilters } from '@/lib/payments/revenue-report';

const money = (cents: number, currency: string) => new Intl.NumberFormat('en', { currency, style: 'currency' }).format(cents / 100);
// A repeated query key (?origin=a&origin=b) delivers an array here at runtime regardless of a
// narrower type annotation; an array is never a meaningful single form-field default.
function displayValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? undefined : value;
}

export default async function RevenuePage({ searchParams }: { searchParams: Promise<RevenueFilters> }) {
  const filters = await searchParams;
  let report: Awaited<ReturnType<typeof getRevenueReport>> | null = null;
  let error: string | null = null;
  try {
    report = await getRevenueReport(filters);
  } catch (thrown) {
    // Only the expected, user-facing date-range validation is caught and rendered inline. Anything
    // else -- an AuthorizationError, a database failure -- is not this page's to interpret or
    // display, and could carry SQL/schema/infrastructure detail unsafe to show a browser; it
    // propagates to the normal server error page instead.
    if (!(thrown instanceof RevenueRangeError)) throw thrown;
    error = thrown.message;
  }
  return <main className="flex-1 py-8 px-5 lg:px-8">
    <h1 className="text-2xl font-semibold">Membership revenue</h1>
    <p className="mt-2 text-sm text-muted-foreground">Historical membership-type attribution is unavailable: payment records do not snapshot the member classification at payment time. Current classifications are not used as historical substitutes.</p>
    <p className="mt-1 text-sm text-muted-foreground">Persisted successful payments, grouped by currency. Dates are inclusive UTC calendar dates.</p>
    <form className="mt-6 flex flex-wrap gap-3" method="get">
      <label className="text-sm">From <input className="block rounded-md border" defaultValue={report?.range.from ?? displayValue(filters.from)} name="from" type="date" /></label>
      <label className="text-sm">Through <input className="block rounded-md border" defaultValue={report?.range.to ?? displayValue(filters.to)} name="to" type="date" /></label>
      <label className="text-sm">Origin <select className="block rounded-md border" defaultValue={displayValue(filters.origin) ?? ''} name="origin"><option value="">All</option><option value="stripe">Stripe</option><option value="manual">Manual</option></select></label>
      <button className="self-end rounded-md border px-4 py-2 text-sm" type="submit">Apply</button>
    </form>
    {error ? <p className="mt-8 text-sm text-red-500" role="alert">{error}</p> : report && <>
      <section className="mt-8 grid gap-4 md:grid-cols-3" aria-label="Revenue summary">
        {report.summary.length === 0 ? <p>No revenue matched this range.</p> : report.summary.map((row) => <article className="rounded-lg border p-4" key={row.currency}><h2 className="font-medium">{row.currency}</h2><p className="text-2xl">{money(row.totalCents, row.currency)}</p><p className="text-sm">{row.paymentCount} payments · average {money(row.averageCents, row.currency)}</p></article>)}
      </section>
      <h2 className="mt-8 text-lg font-medium">Revenue by source</h2>
      {report.bySource.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No revenue matched this range.</p> : <table className="mt-2 min-w-full border text-sm"><thead><tr><th className="p-2 text-left">Source</th><th className="p-2 text-left">Currency</th><th className="p-2 text-right">Revenue</th></tr></thead><tbody>{report.bySource.map((row) => <tr className="border-t" key={`${row.currency}-${row.source}`}><td className="p-2">{row.source}</td><td className="p-2">{row.currency}</td><td className="p-2 text-right">{money(row.totalCents, row.currency)}</td></tr>)}</tbody></table>}
      <h2 className="mt-8 text-lg font-medium">Revenue over time</h2>
      {report.overTime.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No revenue matched this range.</p> : <table className="mt-2 min-w-full border text-sm"><thead><tr><th className="p-2 text-left">Month (UTC)</th><th className="p-2 text-left">Currency</th><th className="p-2 text-right">Revenue</th></tr></thead><tbody>{report.overTime.map((row) => <tr className="border-t" key={`${row.month}-${row.currency}`}><td className="p-2">{row.month}</td><td className="p-2">{row.currency}</td><td className="p-2 text-right">{money(row.totalCents, row.currency)}</td></tr>)}</tbody></table>}
    </>}
  </main>;
}
