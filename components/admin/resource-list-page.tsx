import Link from 'next/link';
import { ResourceDataTable, type ResourceRow } from '@/components/admin/resource-data-table';
import { getTablePreferences } from '@/lib/admin/table-preferences';
import { listAdminContentPages } from '@/lib/content/pages';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';
import { listAdminArticles } from '@/lib/news/articles';
import { listAdminSeminars } from '@/lib/seminars/seminars';

type ResourceType = 'news' | 'seminars' | 'content_pages';

const CONFIG = {
  news: { path: '/admin/news', title: 'News / Blog', description: 'Create, schedule, preview, and publish public articles.', create: 'New article' },
  seminars: { path: '/admin/seminars', title: 'Seminars', description: 'Create, publish, and manage seminar registrations.', create: 'New seminar' },
  content_pages: { path: '/admin/pages', title: 'Pages', description: 'Author revisioned public and member content.', create: 'New page' },
} as const;

export async function ResourceListPage({ tableType }: { tableType: ResourceType }) {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const config = CONFIG[tableType];
  // Filters, sort, columns, and pagination all come from the database, never the URL -- see
  // components/admin/table-preference-sync.tsx and docs/07.
  const preferences = await getTablePreferences(tableType);
  const listQuery = {
    audience: typeof preferences?.audience === 'string' ? preferences.audience : undefined,
    from: typeof preferences?.from === 'string' ? preferences.from : undefined,
    page: typeof preferences?.page === 'number' ? String(preferences.page) : undefined,
    pageSize: typeof preferences?.pageSize === 'number' ? String(preferences.pageSize) : undefined,
    q: typeof preferences?.q === 'string' ? preferences.q : undefined,
    sort: typeof preferences?.sort === 'string' ? preferences.sort : undefined,
    status: typeof preferences?.status === 'string' ? preferences.status : undefined,
    to: typeof preferences?.to === 'string' ? preferences.to : undefined,
  };
  let rows: ResourceRow[];
  let page: number;
  let pageSize: number;
  let total: number;
  if (tableType === 'news') {
    const listing = await listAdminArticles(listQuery);
    ({ page, pageSize, total } = listing);
    rows = listing.rows.map((row) => ({
      id: Number(row.id), title: String(row.title),
      subtitle: row.subtitle ? String(row.subtitle) : '', slug: String(row.slug),
      status: String(row.status),
      publication: new Date(String(row.publication_date)).toISOString().replace('T', ' ').slice(0, 16) + ' UTC',
      updated: new Date(String(row.updated_at)).toLocaleString(),
    }));
  } else if (tableType === 'seminars') {
    const listing = await listAdminSeminars(listQuery);
    ({ page, pageSize, total } = listing);
    rows = listing.rows.map((row) => ({
      id: Number(row.id), title: String(row.title),
      date: `${String(row.seminar_date)} ${String(row.start_time).slice(0, 5)}`,
      status: String(row.status),
      payment: String(row.payment_method_canonical_id).replaceAll('_', ' '),
      registrations: `${String(row.registered_count)} / ${String(row.capacity)}`,
    }));
  } else {
    const listing = await listAdminContentPages(listQuery);
    ({ page, pageSize, total } = listing);
    rows = listing.rows.map((row) => ({
      id: Number(row.id), title: String(row.title), slug: String(row.slug),
      status: String(row.status),
      audience: `${String(row.audiences)} (${String(row.audience_mode)})`,
      updated: new Date(String(row.updated_at)).toLocaleString(),
    }));
  }
  return <main className="space-y-6 px-5 py-8 lg:px-8">
    <header className="flex items-center justify-between gap-4"><div><h1 className="text-2xl font-semibold">{config.title}</h1><p className="text-muted-foreground">{config.description}</p></div><Link className="rounded bg-primary px-4 py-2 uppercase tracking-wide text-primary-foreground" href={`${config.path}/new`}>{config.create}</Link></header>
    <ResourceDataTable
      initialColumnOrder={typeof preferences?.columnOrder === 'string' ? preferences.columnOrder : undefined}
      initialFrom={listQuery.from}
      initialSearch={listQuery.q}
      initialSort={listQuery.sort}
      initialTo={listQuery.to}
      initialVisibleColumns={Array.isArray(preferences?.columns) ? preferences.columns : undefined}
      page={page} pageSize={pageSize} rows={rows} tableType={tableType} total={total}
    />
  </main>;
}
