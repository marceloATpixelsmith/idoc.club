import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ResourceDataTable, type ResourceRow } from '@/components/admin/resource-data-table';
import { getTablePreferences, preferenceQuery } from '@/lib/admin/table-preferences';
import { listAdminContentPages } from '@/lib/content/pages';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';
import { listAdminArticles } from '@/lib/news/articles';
import { listAdminSeminars } from '@/lib/seminars/seminars';

type ResourceType = 'news' | 'seminars' | 'content_pages';
type Query = Record<string, string | string[] | undefined>;

const CONFIG = {
  news: { path: '/admin/news', title: 'News / Blog', description: 'Create, schedule, preview, and publish public articles.', create: 'New article' },
  seminars: { path: '/admin/seminars', title: 'Seminars', description: 'Create, publish, and manage seminar registrations.', create: 'New seminar' },
  content_pages: { path: '/admin/pages', title: 'Pages', description: 'Author revisioned public and member content.', create: 'New page' },
} as const;

export async function ResourceListPage({ query, tableType }: { query: Query; tableType: ResourceType }) {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const config = CONFIG[tableType];
  if (!Object.keys(query).length)
    {
    const saved = preferenceQuery(await getTablePreferences(tableType));
    if (Object.keys(saved).length)
      {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(saved))
        {
        if (Array.isArray(value))
          {
          if (key === 'column' && !value.length) params.append(key, '');
          else for (const entry of value) params.append(key, entry);
          }
        else params.set(key, value);
        }
      redirect(`${config.path}?${params}`);
      }
    }
  const legacySort = Array.isArray(query.sort) ? query.sort[0] : query.sort;
  const legacyDirection = Array.isArray(query.direction) ? query.direction[0] : query.direction;
  const sortable = tableType === 'news' ? ['publication', 'title', 'status', 'updated']
    : tableType === 'seminars' ? ['date', 'title', 'status', 'registrations'] : ['title', 'status', 'updated'];
  if ((legacySort && sortable.includes(legacySort)) || (!legacySort && legacyDirection === 'asc'))
    {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query))
      {
      if (key === 'sort' || key === 'direction' || value === undefined) continue;
      for (const entry of Array.isArray(value) ? value : [value]) params.append(key, entry);
      }
    params.set('sort', JSON.stringify([{ id: legacySort || (tableType === 'news' ? 'publication' : tableType === 'seminars' ? 'date' : 'updated'), desc: legacyDirection !== 'asc' }]));
    redirect(`${config.path}?${params}`);
    }
  let rows: ResourceRow[];
  let page: number;
  let pageSize: number;
  let total: number;
  if (tableType === 'news')
    {
    const listing = await listAdminArticles(query);
    ({ page, pageSize, total } = listing);
    rows = listing.rows.map((row) => ({
      id: Number(row.id), title: String(row.title),
      subtitle: row.subtitle ? String(row.subtitle) : '', slug: String(row.slug),
      status: String(row.status),
      publication: new Date(String(row.publication_date)).toISOString().replace('T', ' ').slice(0, 16) + ' UTC',
      updated: new Date(String(row.updated_at)).toLocaleString(),
    }));
    }
  else if (tableType === 'seminars')
    {
    const listing = await listAdminSeminars(query);
    ({ page, pageSize, total } = listing);
    rows = listing.rows.map((row) => ({
      id: Number(row.id), title: String(row.title),
      date: `${String(row.seminar_date)} ${String(row.start_time).slice(0, 5)}`,
      status: String(row.status),
      payment: String(row.payment_method_canonical_id).replaceAll('_', ' '),
      registrations: `${String(row.registered_count)} / ${String(row.capacity)}`,
    }));
    }
  else
    {
    const listing = await listAdminContentPages(query);
    ({ page, pageSize, total } = listing);
    rows = listing.rows.map((row) => ({
      id: Number(row.id), title: String(row.title), slug: String(row.slug),
      status: String(row.status),
      audience: `${String(row.audiences)} (${String(row.audience_mode)})`,
      updated: new Date(String(row.updated_at)).toLocaleString(),
    }));
    }
  if (page > 1 && !rows.length)
    {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query))
      {
      if (key === 'page' || value === undefined) continue;
      for (const entry of Array.isArray(value) ? value : [value]) params.append(key, entry);
      }
    redirect(`${config.path}?${params}`);
    }
  return <main className="space-y-6 px-5 py-8 lg:px-8">
    <header className="flex items-center justify-between gap-4"><div><h1 className="text-2xl font-semibold">{config.title}</h1><p className="text-muted-foreground">{config.description}</p></div><Link className="rounded bg-primary px-4 py-2 uppercase tracking-wide text-primary-foreground" href={`${config.path}/new`}>{config.create}</Link></header>
    <ResourceDataTable page={page} pageSize={pageSize} rows={rows} tableType={tableType} total={total} />
  </main>;
}
