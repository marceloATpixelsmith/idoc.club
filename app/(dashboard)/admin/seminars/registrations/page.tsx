import { getTablePreferences } from '@/lib/admin/table-preferences';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';
import { getAdminSeminarRegistration, listAdminAllSeminarRegistrations, listAllSeminarPaymentMethodsForAdmin, listEnabledSeminarPaymentMethods, listPublishedSeminarsForRegistrationFilter } from '@/lib/seminars/registrations';
import { RegistrationsTable } from './registrations-table';
import { RegistrationDetailSheet } from './registration-detail-sheet';
import { RegistrationCreateDrawer } from './registration-create-drawer';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default async function AdminSeminarRegistrationsPage({ searchParams }: { searchParams: Promise<{ new?: string; registrationId?: string; seminarId?: string }> }) {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  // Filters, sort, columns, and pagination all come from the database, never the URL -- see
  // components/admin/table-preference-sync.tsx and docs/07. `seminarId` is the one deliberate
  // exception, of the same short-lived, single-step shape as the Members page's `profileId` and the
  // Support page's `memberEmail`: the Seminars table's "Registrations" row action seeds this filter
  // for one navigation only -- picking a different seminar facet later goes back through the normal
  // DB-persisted value. `registrationId` opens the edit drawer, mirroring `profileId` on Members.
  const { new: newParam, registrationId: registrationIdParam, seminarId: seminarIdParam } = await searchParams;
  const isNew = newParam === '1';
  const saved = await getTablePreferences('seminar_registrations');
  const listQuery = {
    from: typeof saved?.from === 'string' ? saved.from : undefined,
    page: seminarIdParam ? undefined : typeof saved?.page === 'number' ? String(saved.page) : undefined,
    pageSize: typeof saved?.pageSize === 'number' ? String(saved.pageSize) : undefined,
    paymentStatus: typeof saved?.paymentStatus === 'string' ? saved.paymentStatus : undefined,
    q: typeof saved?.q === 'string' ? saved.q : undefined,
    registrantType: typeof saved?.registrantType === 'string' ? saved.registrantType : undefined,
    seminarId: seminarIdParam || (typeof saved?.seminarId === 'string' ? saved.seminarId : undefined),
    sort: typeof saved?.sort === 'string' ? saved.sort : undefined,
    to: typeof saved?.to === 'string' ? saved.to : undefined,
  };
  const [listing, seminarOptions, paymentMethods, enabledPaymentMethods] = await Promise.all([
    listAdminAllSeminarRegistrations(listQuery),
    listPublishedSeminarsForRegistrationFilter(),
    listAllSeminarPaymentMethodsForAdmin(),
    listEnabledSeminarPaymentMethods(),
  ]);
  const registrationId = registrationIdParam ? Number(registrationIdParam) : null;
  const selected = registrationId && Number.isInteger(registrationId) ? await getAdminSeminarRegistration(registrationId) : null;
  return <main className="space-y-6 px-5 py-8 lg:px-8">
    <header className="flex items-center justify-between gap-4"><div><h1 className="text-3xl font-semibold text-gold">Registrations</h1><p className="text-muted-foreground">Every seminar registration, member and guest, across all seminars.</p></div><Button asChild><Link href="/admin/seminars/registrations?new=1">New Registration</Link></Button></header>
    <RegistrationsTable
      filters={{ from: listQuery.from, page: listing.page, pageSize: listing.pageSize, paymentStatus: listQuery.paymentStatus, q: listQuery.q, registrantType: listQuery.registrantType, seminarId: listQuery.seminarId, sort: listQuery.sort, to: listQuery.to }}
      initialColumnOrder={typeof saved?.columnOrder === 'string' ? saved.columnOrder : undefined}
      initialVisibleColumns={Array.isArray(saved?.columns) ? saved.columns : undefined}
      rows={listing.rows as never}
      seminarOptions={seminarOptions.map((seminar) => ({ label: String(seminar.title), value: String(seminar.id) }))}
      total={listing.total}
    />
    {isNew ? <RegistrationCreateDrawer paymentMethods={enabledPaymentMethods.filter((method) => ['bank_transfer', 'cash_event'].includes(method.canonical_id))} seminars={seminarOptions} /> : selected ? <RegistrationDetailSheet closeHref="/admin/seminars/registrations" paymentMethods={paymentMethods} registration={selected} /> : null}
  </main>;
}
