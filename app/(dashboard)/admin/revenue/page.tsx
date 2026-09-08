import { getRevenueReport, RevenueRangeError, type RevenueFilters } from '@/lib/payments/revenue-report';

const money = (cents: number, currency: string) => new Intl.NumberFormat('en', { currency, style: 'currency' }).format(cents / 100);
function RevenueChart({ rows }: { rows: { currency: string; month: string; totalCents: number }[] }) {
  const maximum = Math.max(...rows.map((row) => row.totalCents), 1);
  return <div className="mt-3 rounded-lg border p-4" role="img" aria-label="Monthly gross recorded revenue chart. Exact monthly values follow in the table.">
    <div className="flex min-h-52 items-end gap-2" aria-hidden="true">{rows.map((row) => <div className="flex min-w-10 flex-1 flex-col items-center gap-2" key={`${row.month}-${row.currency}`}><span className="text-xs">{money(row.totalCents, row.currency)}</span><div className="w-full rounded-t bg-primary" style={{ height: `${Math.max(4, (row.totalCents / maximum) * 150)}px` }} /><span className="text-xs">{row.month}<br />{row.currency}</span></div>)}</div>
  </div>;
}
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
      <section className="mt-8" aria-label="Revenue summary">
        {report.summary.length === 0 ? <p>No recorded revenue matched this range.</p> : report.summary.map((row) => <div className="mb-4" key={row.currency}><h2 className="mb-2 font-medium">{row.currency}</h2><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><article className="rounded-lg border p-4"><h3 className="text-sm text-muted-foreground">Gross recorded revenue</h3><p className="mt-1 text-2xl font-semibold">{money(row.totalCents, row.currency)}</p></article><article className="rounded-lg border p-4"><h3 className="text-sm text-muted-foreground">Stripe revenue</h3><p className="mt-1 text-2xl font-semibold">{money(row.stripeCents, row.currency)}</p></article><article className="rounded-lg border p-4"><h3 className="text-sm text-muted-foreground">Manual revenue</h3><p className="mt-1 text-2xl font-semibold">{money(row.manualCents, row.currency)}</p></article><article className="rounded-lg border p-4"><h3 className="text-sm text-muted-foreground">Payments recorded</h3><p className="mt-1 text-2xl font-semibold">{row.paymentCount}</p></article></div></div>)}
      </section>
      <h2 className="mt-8 text-lg font-medium">Revenue by source</h2>
      {report.bySource.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No revenue matched this range.</p> : <table className="mt-2 min-w-full border text-sm"><thead><tr><th className="p-2 text-left">Source</th><th className="p-2 text-left">Currency</th><th className="p-2 text-right">Revenue</th></tr></thead><tbody>{report.bySource.map((row) => <tr className="border-t" key={`${row.currency}-${row.source}`}><td className="p-2">{row.source}</td><td className="p-2">{row.currency}</td><td className="p-2 text-right">{money(row.totalCents, row.currency)}</td></tr>)}</tbody></table>}
      <h2 className="mt-8 text-lg font-medium">Revenue over time</h2>
      {report.overTime.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No revenue matched this range.</p> : <><RevenueChart rows={report.overTime} /><table className="mt-4 min-w-full border text-sm"><caption className="sr-only">Exact monthly gross recorded revenue values</caption><thead><tr><th className="p-2 text-left">Month (UTC)</th><th className="p-2 text-left">Currency</th><th className="p-2 text-right">Gross recorded revenue</th></tr></thead><tbody>{report.overTime.map((row) => <tr className="border-t" key={`${row.month}-${row.currency}`}><td className="p-2">{row.month}</td><td className="p-2">{row.currency}</td><td className="p-2 text-right">{money(row.totalCents, row.currency)}</td></tr>)}</tbody></table></>}
    </>}
  </main>;
}
