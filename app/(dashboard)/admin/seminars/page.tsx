import Link from 'next/link';
import { ActiveFilterChips, ColumnVisibility, parseHiddenColumns } from '@/components/admin/table-controls';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';
import { listAdminSeminars } from '@/lib/seminars/seminars';
import { getTablePreferences, preferenceQuery } from '@/lib/admin/table-preferences';
import { TablePreferenceSync } from '@/components/admin/table-preference-sync';
import { SEMINAR_STATUSES } from '@/lib/seminars/status';

const COLUMNS = ['date', 'status', 'payment', 'registrations'] as const;
const STATUS_LABELS: Record<string, string> = { canceled: 'Canceled', draft: 'Draft', published: 'Published' };

export default async function AdminSeminarsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const rawQuery = await searchParams;
  const query = Object.keys(rawQuery).length ? rawQuery : preferenceQuery(await getTablePreferences('seminars'));
  const scalar = (name: string) => Array.isArray(query[name]) ? query[name][0] : query[name];
  const hidden = parseHiddenColumns(query.column, COLUMNS);
  const scalarQuery = Object.fromEntries(Object.entries(query).flatMap(([key, value]) => {
    const scalar = Array.isArray(value) ? value[0] : value;
    return scalar && key !== 'column' ? [[key, scalar]] : [];
  }));
  const { rows, page, hasNext } = await listAdminSeminars(query);
  const sortHref = (sort: string) => `/admin/seminars?${new URLSearchParams({ ...scalarQuery, sort, direction: scalar('sort') === sort && scalar('direction') !== 'asc' ? 'asc' : 'desc' }).toString()}`;
  const href = (next: number) => `/admin/seminars?${new URLSearchParams({ ...scalarQuery, page: String(next) }).toString()}`;
  return (
    <main className="space-y-6 py-8 px-5 lg:px-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Seminars</h1>
          <p className="text-muted-foreground">Create, publish, and manage seminar registrations.</p>
        </div>
        <Link className="rounded bg-primary px-4 py-2 text-primary-foreground" href="/admin/seminars/new">New seminar</Link>
      </header>
      <TablePreferenceSync table="seminars" /><form data-table-preferences="seminars" className="grid gap-3 rounded-lg border p-4 md:grid-cols-7" method="get">
        <label>Search<input className="block w-full border p-2" defaultValue={scalarQuery.q} name="q" /></label>
        <label>Status<select className="block w-full border p-2" defaultValue={scalarQuery.status} name="status">
          <option value="">All</option>
          {SEMINAR_STATUSES.map((value) => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}
        </select></label>
        <label>From<input className="block w-full border p-2" defaultValue={scalar('from')} name="from" type="date" /></label>
        <label>To<input className="block w-full border p-2" defaultValue={scalar('to')} name="to" type="date" /></label>
        <ColumnVisibility columns={COLUMNS.map((value) => ({ label: value[0].toUpperCase() + value.slice(1), value }))} hidden={hidden} />
        <button className="self-end rounded bg-primary p-2 text-primary-foreground" type="submit">Filter</button>
      </form>
      <ActiveFilterChips filters={[{ label: 'Search', name: 'q', value: scalar('q') }, { label: 'Status', name: 'status', value: scalar('status') }, { label: 'From', name: 'from', value: scalar('from') }, { label: 'To', name: 'to', value: scalar('to') }]} pathname="/admin/seminars" query={scalarQuery} />
      {rows.length === 0 ? <div className="rounded-lg border border-dashed p-10 text-center"><h2 className="font-semibold">No seminars found</h2><p className="text-sm text-muted-foreground">Clear filters or create a seminar.</p></div> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead><tr><th className="p-2"><Link href={sortHref('title')}>Title</Link></th>{!hidden.has('date') && <th><Link href={sortHref('date')}>Date</Link></th>}{!hidden.has('status') && <th><Link href={sortHref('status')}>Status</Link></th>}{!hidden.has('payment') && <th>Payment method</th>}{!hidden.has('registrations') && <th><Link href={sortHref('registrations')}>Registered / Capacity</Link></th>}</tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr className="border-t" key={String(row.id)}>
                  <td className="p-2"><Link className="font-medium underline" href={`/admin/seminars/${row.id}`}>{String(row.title)}</Link></td>
                  {!hidden.has('date') && <td>{String(row.seminar_date)} {String(row.start_time).slice(0, 5)}</td>}
                  {!hidden.has('status') && <td>{STATUS_LABELS[String(row.status)]}</td>}
                  {!hidden.has('payment') && <td>{String(row.payment_method_canonical_id).replaceAll('_', ' ')}</td>}
                  {!hidden.has('registrations') && <td>{String(row.registered_count)} / {String(row.capacity)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <nav className="flex gap-4">
        {page > 1 ? <Link href={href(page - 1)}>← Previous</Link> : null}
        {hasNext ? <Link href={href(page + 1)}>Next →</Link> : null}
      </nav>
    </main>
  );
}
