import Link from 'next/link';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';
import { listAdminSeminars } from '@/lib/seminars/seminars';
import { SEMINAR_STATUSES } from '@/lib/seminars/status';

const STATUS_LABELS: Record<string, string> = { canceled: 'Canceled', draft: 'Draft', published: 'Published' };

export default async function AdminSeminarsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const query = await searchParams;
  const scalarQuery = Object.fromEntries(Object.entries(query).flatMap(([key, value]) => {
    const scalar = Array.isArray(value) ? value[0] : value;
    return scalar ? [[key, scalar]] : [];
  }));
  const { rows, page, hasNext } = await listAdminSeminars(query);
  const href = (next: number) => `/admin/seminars?${new URLSearchParams({ ...scalarQuery, page: String(next) }).toString()}`;
  return (
    <main className="space-y-6 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Seminars</h1>
          <p className="text-muted-foreground">Create, publish, and manage seminar registrations.</p>
        </div>
        <Link className="rounded bg-primary px-4 py-2 text-primary-foreground" href="/admin/seminars/new">New seminar</Link>
      </header>
      <form className="grid gap-3 rounded-lg border p-4 md:grid-cols-4" method="get">
        <label>Search<input className="block w-full border p-2" defaultValue={scalarQuery.q} name="q" /></label>
        <label>Status<select className="block w-full border p-2" defaultValue={scalarQuery.status} name="status">
          <option value="">All</option>
          {SEMINAR_STATUSES.map((value) => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}
        </select></label>
        <button className="self-end rounded bg-primary p-2 text-primary-foreground" type="submit">Filter</button>
      </form>
      {rows.length === 0 ? <p>No seminars match these filters.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead><tr><th className="p-2">Title</th><th>Date</th><th>Status</th><th>Registered / Capacity</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr className="border-t" key={String(row.id)}>
                  <td className="p-2"><Link className="font-medium underline" href={`/admin/seminars/${row.id}`}>{String(row.title)}</Link></td>
                  <td>{String(row.seminar_date)} {String(row.start_time).slice(0, 5)}</td>
                  <td>{STATUS_LABELS[String(row.status)]}</td>
                  <td>{String(row.registered_count)} / {String(row.capacity)}</td>
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
