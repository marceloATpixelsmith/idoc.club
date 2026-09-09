import Link from 'next/link';
import { ActiveFilterChips, ColumnVisibility, parseHiddenColumns } from '@/components/admin/table-controls';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';
import { getTablePreferences, preferenceQuery } from '@/lib/admin/table-preferences';
import { TablePreferenceSync } from '@/components/admin/table-preference-sync';
import { listAdminArticles, NEWS_STATUSES, STATUS_LABELS } from '@/lib/news/articles';

const COLUMNS = ['subtitle', 'slug', 'status', 'publication', 'updated'] as const;
export default async function AdminNewsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireAccountAccess('administration'); requireAdministrator(actor);
  const rawQuery = await searchParams;
  const query = Object.keys(rawQuery).length ? rawQuery : preferenceQuery(await getTablePreferences('news'));
  const scalar = (name: string) => Array.isArray(query[name]) ? query[name][0] : query[name];
  const scalarQuery = Object.fromEntries(Object.entries(query).flatMap(([key, value]) => key === 'column' ? [] : [[key, Array.isArray(value) ? value[0] : value ?? '']]));
  const hidden = parseHiddenColumns(query.column, COLUMNS);
  const { rows, page, hasNext } = await listAdminArticles(query);
  const paramsFor = (changes: Record<string, string>) => new URLSearchParams({ ...scalarQuery, ...changes }).toString();
  const sortLink = (key: string) => `/admin/news?${paramsFor({ sort: key, direction: scalar('sort') === key && scalar('direction') !== 'asc' ? 'asc' : 'desc' })}`;
  return <main className="space-y-6 px-5 py-8 lg:px-8">
    <header className="flex items-center justify-between"><div><h1 className="text-2xl font-semibold">News / Blog</h1><p className="text-muted-foreground">Create, schedule, preview, and publish public articles.</p></div><Link className="rounded bg-primary px-4 py-2 text-primary-foreground" href="/admin/news/new">New article</Link></header>
    <TablePreferenceSync table="news" /><form data-table-preferences="news" className="grid gap-3 rounded-lg border p-4 md:grid-cols-6" method="get">
      <label>Search<input className="block w-full border p-2" defaultValue={scalar('q')} name="q" /></label>
      <label>Status<select className="block w-full border p-2" defaultValue={scalar('status')} name="status"><option value="">All</option>{NEWS_STATUSES.map((value) => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}</select></label>
      <label>From<input className="block w-full border p-2" defaultValue={scalar('from')} name="from" type="date" /></label>
      <label>To<input className="block w-full border p-2" defaultValue={scalar('to')} name="to" type="date" /></label>
      <ColumnVisibility columns={COLUMNS.map((value) => ({ label: value[0].toUpperCase() + value.slice(1), value }))} hidden={hidden} />
      <button className="self-end rounded bg-primary p-2 text-primary-foreground" type="submit">Apply</button>
    </form>
    <ActiveFilterChips filters={[{ label: 'Search', name: 'q', value: scalar('q') }, { label: 'Status', name: 'status', value: scalar('status') }, { label: 'From', name: 'from', value: scalar('from') }, { label: 'To', name: 'to', value: scalar('to') }]} pathname="/admin/news" query={scalarQuery} />
    {rows.length === 0 ? <div className="rounded-lg border border-dashed p-10 text-center"><h2 className="font-semibold">No articles found</h2><p className="text-sm text-muted-foreground">Clear filters or create a new article.</p></div> : <div className="overflow-x-auto rounded-lg border"><table className="w-full text-left"><thead><tr><th className="p-3"><Link href={sortLink('title')}>Title</Link></th>{!hidden.has('subtitle') && <th>Subtitle</th>}{!hidden.has('slug') && <th>Slug</th>}{!hidden.has('status') && <th><Link href={sortLink('status')}>Status</Link></th>}{!hidden.has('publication') && <th><Link href={sortLink('publication')}>Publication date</Link></th>}{!hidden.has('updated') && <th><Link href={sortLink('updated')}>Updated</Link></th>}</tr></thead><tbody>{rows.map((row) => <tr className="border-t" key={String(row.id)}><td className="p-3"><Link className="font-medium underline" href={`/admin/news/${row.id}`}>{String(row.title)}</Link></td>{!hidden.has('subtitle') && <td>{row.subtitle ? String(row.subtitle) : '—'}</td>}{!hidden.has('slug') && <td className="text-sm text-muted-foreground">{String(row.slug)}</td>}{!hidden.has('status') && <td>{STATUS_LABELS[row.status as keyof typeof STATUS_LABELS]}</td>}{!hidden.has('publication') && <td>{new Date(String(row.publication_date)).toISOString().replace('T', ' ').slice(0, 16)} UTC</td>}{!hidden.has('updated') && <td>{new Date(String(row.updated_at)).toLocaleString()}</td>}</tr>)}</tbody></table></div>}
    <nav aria-label="Pagination" className="flex gap-4">{page > 1 && <Link href={`/admin/news?${paramsFor({ page: String(page - 1) })}`}>← Previous</Link>}{hasNext && <Link href={`/admin/news?${paramsFor({ page: String(page + 1) })}`}>Next →</Link>}</nav>
  </main>;
}
