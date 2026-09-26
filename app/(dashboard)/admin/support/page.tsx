import { getTablePreferences } from '@/lib/admin/table-preferences';
import { listAdminConversations, listEligibleAdministrators } from '@/lib/support/inbox';
import { SupportInboxTable } from './support-inbox-table';

export default async function AdminSupportPage() {
  // Filters, sort, columns, and pagination all come from the database, never the URL -- see
  // components/admin/table-preference-sync.tsx and docs/07.
  const saved = await getTablePreferences('support');
  const listQuery = {
    activityFrom: typeof saved?.activityFrom === 'string' ? saved.activityFrom : undefined,
    activityTo: typeof saved?.activityTo === 'string' ? saved.activityTo : undefined,
    assigned: typeof saved?.assigned === 'string' ? saved.assigned : undefined,
    category: typeof saved?.category === 'string' ? saved.category : undefined,
    page: typeof saved?.page === 'number' ? String(saved.page) : undefined,
    pageSize: typeof saved?.pageSize === 'number' ? String(saved.pageSize) : undefined,
    q: typeof saved?.q === 'string' ? saved.q : undefined,
    sort: typeof saved?.sort === 'string' ? saved.sort : undefined,
    status: typeof saved?.status === 'string' ? saved.status : undefined,
  };
  const [listing, administrators] = await Promise.all([listAdminConversations(listQuery), listEligibleAdministrators()]);
  return <main className="space-y-6 px-5 py-8 lg:px-8"><header><h1 className="text-2xl font-semibold">Support Inbox</h1><p className="text-muted-foreground">Member conversations and assignment queue.</p></header><SupportInboxTable administrators={administrators.map((admin) => ({ label: String(admin.display_name), value: String(admin.assignment_key) }))} filters={{ activityFrom: listQuery.activityFrom, activityTo: listQuery.activityTo, page: listing.page, pageSize: listing.pageSize, q: listQuery.q, sort: listQuery.sort }} initialColumnOrder={typeof saved?.columnOrder === 'string' ? saved.columnOrder : undefined} initialVisibleColumns={Array.isArray(saved?.columns) ? saved.columns : undefined} rows={listing.rows} total={listing.total} /></main>;
}
