import Link from 'next/link';
import { ResourceDataTable, type ResourceRow } from '@/components/admin/resource-data-table';
import { formatAdminDate } from '@/lib/seminars/format';
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
      publication: formatAdminDate(new Date(String(row.publication_date)).toISOString().slice(0, 10)),
      updated: new Date(String(row.updated_at)).toLocaleString(),
    }));
  } else if (tableType === 'seminars') {
    const listing = await listAdminSeminars(listQuery);
    ({ page, pageSize, total } = listing);
    rows = listing.rows.map((row) => ({
      id: Number(row.id), title: String(row.title),
      start: formatAdminDate(String(row.start_date)), end: formatAdminDate(String(row.end_date)),
      deadline: formatAdminDate(new Date(String(row.registration_deadline)).toISOString().slice(0, 10)), status: String(row.status),
      prices: `€${(Number(row.member_price_cents) / 100).toFixed(2)} / €${(Number(row.non_member_price_cents) / 100).toFixed(2)}`,
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
    <header className="flex items-center justify-between gap-4"><div><h1 className="text-3xl font-semibold text-gold">{config.title}</h1><p className="text-muted-foreground">{config.description}</p></div><Link className="rounded bg-primary px-4 py-2 uppercase tracking-wide text-primary-foreground" href={`${config.path}/new`}>{config.create}</Link></header>
    <ResourceDataTable
      initialAudience={listQuery.audience}
      initialColumnOrder={typeof preferences?.columnOrder === 'string' ? preferences.columnOrder : undefined}
      initialFrom={listQuery.from}
      initialSearch={listQuery.q}
      initialSort={listQuery.sort}
      initialStatus={listQuery.status}
      initialTo={listQuery.to}
      initialVisibleColumns={Array.isArray(preferences?.columns) ? preferences.columns : undefined}
      page={page} pageSize={pageSize} rows={rows} tableType={tableType} total={total}
    />
  </main>;
}
