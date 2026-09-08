import Link from 'next/link';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';
import { listAdminArticles, NEWS_STATUSES, STATUS_LABELS } from '@/lib/news/articles';

export default async function AdminNewsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const query = await searchParams;
  const scalarQuery = Object.fromEntries(Object.entries(query).flatMap(([key, value]) => {
    const scalar = Array.isArray(value) ? value[0] : value;
    return scalar ? [[key, scalar]] : [];
  }));
  const { rows, page, hasNext } = await listAdminArticles(query);
  const href = (next: number) => `/admin/news?${new URLSearchParams({ ...scalarQuery, page: String(next) }).toString()}`;
  return (
    <main className="space-y-6 py-8 px-5 lg:px-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">News / Blog</h1>
          <p className="text-muted-foreground">Create, schedule, and publish public articles.</p>
        </div>
        <Link className="rounded bg-primary px-4 py-2 text-primary-foreground" href="/admin/news/new">New article</Link>
      </header>
      <form className="grid gap-3 rounded-lg border p-4 md:grid-cols-4" method="get">
        <label>Search<input className="block w-full border p-2" defaultValue={scalarQuery.q} name="q" /></label>
        <label>Status<select className="block w-full border p-2" defaultValue={scalarQuery.status} name="status">
          <option value="">All</option>
          {NEWS_STATUSES.map((value) => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}
        </select></label>
        <button className="self-end rounded bg-primary p-2 text-primary-foreground" type="submit">Filter</button>
      </form>
      {rows.length === 0 ? <p>No articles match these filters.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead><tr><th className="p-2">Title</th><th>Slug</th><th>Status</th><th>Publication date</th><th>Updated</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr className="border-t" key={String(row.id)}>
                  <td className="p-2"><Link className="font-medium underline" href={`/admin/news/${row.id}`}>{String(row.title)}</Link></td>
                  <td className="text-sm text-muted-foreground">{String(row.slug)}</td>
                  <td>{STATUS_LABELS[row.status as keyof typeof STATUS_LABELS]}</td>
                  <td>{new Date(String(row.publication_date)).toISOString().replace('T', ' ').slice(0, 16)} UTC</td>
                  <td>{new Date(String(row.updated_at)).toLocaleString()}</td>
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
