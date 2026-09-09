import { getTablePreferences, preferenceQuery } from '@/lib/admin/table-preferences';
import { listAdminConversations, listEligibleAdministrators, type SupportSearchParams } from '@/lib/support/inbox';
import { SupportInboxTable } from './support-inbox-table';

const TABLE_KEYS = ['q', 'category', 'status', 'assigned', 'filters', 'joinOperator', 'sort', 'direction', 'page', 'pageSize', 'column'];

export default async function AdminSupportPage({ searchParams }: { searchParams: Promise<SupportSearchParams> }) {
  const params = await searchParams;
  const hasUrlState = TABLE_KEYS.some((key) => params[key] !== undefined);
  const saved = hasUrlState ? null : await getTablePreferences('support');
  const query = hasUrlState ? params : { ...preferenceQuery(saved), ...params };
  const visibleColumns = query.column ? (Array.isArray(query.column) ? query.column : [query.column]) : Array.isArray(saved?.columns) ? saved.columns : undefined;
  const [listing, administrators] = await Promise.all([listAdminConversations(query), listEligibleAdministrators()]);
  return <main className="space-y-6 px-5 py-8 lg:px-8"><header><h1 className="text-2xl font-semibold">Support Inbox</h1><p className="text-muted-foreground">Member conversations and assignment queue.</p></header><SupportInboxTable administrators={administrators.map((admin) => ({ label: String(admin.display_name), value: String(admin.assignment_key) }))} filters={{ page: listing.page, pageSize: listing.pageSize, q: Array.isArray(query.q) ? query.q[0] : query.q, category: query.category, status: query.status, assigned: query.assigned, filters: query.filters, joinOperator: query.joinOperator, sort: query.sort, direction: query.direction }} initialVisibleColumns={visibleColumns} rows={listing.rows} total={listing.total} /></main>;
}
