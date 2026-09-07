import Link from 'next/link';
import { CATEGORY_LABELS, listAdminConversations, listEligibleAdministrators, STATUS_LABELS, SUPPORT_CATEGORIES, SUPPORT_STATUSES, type SupportSearchParams } from '@/lib/support/inbox';

export default async function AdminSupportPage({ searchParams }: { searchParams: Promise<SupportSearchParams> }) {
  const query = await searchParams;
  const scalarQuery = Object.fromEntries(Object.entries(query).flatMap(([key, value]) => {
    const scalar = Array.isArray(value) ? value[0] : value;
    return scalar ? [[key, scalar]] : [];
  }));
  const [{ rows, page, hasNext }, administrators] = await Promise.all([listAdminConversations(query), listEligibleAdministrators()]);
  const href = (next: number) => `/admin/support?${new URLSearchParams({ ...scalarQuery, page: String(next) }).toString()}`;
  return <main className="space-y-6 p-8"><header><h1 className="text-2xl font-semibold">Support Inbox</h1><p className="text-muted-foreground">Member conversations and assignment queue.</p></header>
    <form className="grid gap-3 rounded-lg border p-4 md:grid-cols-5" method="get"><label>Search<input className="block w-full border p-2" defaultValue={scalarQuery.q} name="q" /></label><label>Category<select className="block w-full border p-2" defaultValue={scalarQuery.category} name="category"><option value="">All</option>{SUPPORT_CATEGORIES.map((value) => <option key={value} value={value}>{CATEGORY_LABELS[value]}</option>)}</select></label><label>Status<select className="block w-full border p-2" defaultValue={scalarQuery.status} name="status"><option value="">All</option>{SUPPORT_STATUSES.map((value) => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}</select></label><label>Assigned<select className="block w-full border p-2" defaultValue={scalarQuery.assigned} name="assigned"><option value="">Anyone</option><option value="unassigned">Unassigned</option>{administrators.map((admin) => <option key={String(admin.assignment_key)} value={String(admin.assignment_key)}>{String(admin.display_name)}</option>)}</select></label><button className="self-end rounded bg-primary p-2 text-primary-foreground" type="submit">Filter</button></form>
    {rows.length === 0 ? <p>No conversations match these filters.</p> : <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr><th className="p-2">Member</th><th>Subject</th><th>Category</th><th>Status</th><th>Assigned</th><th>Activity</th></tr></thead><tbody>{rows.map((row) => <tr className="border-t" key={String(row.public_id)}><td className="p-2">{String(row.member_name)}<br /><span className="text-sm text-muted-foreground">{String(row.member_email)}</span></td><td><Link className="font-medium underline" href={`/admin/support/${row.public_id}?returnTo=${encodeURIComponent(`/admin/support?${new URLSearchParams(scalarQuery)}`)}`}>{String(row.subject)}{row.unread ? ' · New' : ''}</Link></td><td>{CATEGORY_LABELS[row.category as keyof typeof CATEGORY_LABELS]}</td><td>{STATUS_LABELS[String(row.status)]}</td><td>{row.assignee_name ? String(row.assignee_name) : 'Unassigned'}</td><td>{new Date(String(row.updated_at)).toLocaleString()}</td></tr>)}</tbody></table></div>}
    <nav className="flex gap-4">{page > 1 ? <Link href={href(page - 1)}>← Previous</Link> : null}{hasNext ? <Link href={href(page + 1)}>Next →</Link> : null}</nav>
  </main>;
}
