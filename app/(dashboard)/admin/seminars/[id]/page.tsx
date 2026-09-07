import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';
import { SeminarFieldset } from '@/components/seminars/seminar-fieldset';
import { SeminarForm } from '@/components/seminars/seminar-form';
import { getAdminSeminar, listEnabledSeminarPaymentMethods, seminarEndsAtUtc } from '@/lib/seminars/seminars';
import { listAdminSeminarRegistrations } from '@/lib/seminars/registrations';
import { AVAILABILITY_LABELS, computeSeminarAvailability, PAYMENT_STATUS_LABELS, registrationDisplayLabel } from '@/lib/seminars/status';
import {
  cancelSeminarAction, markSeminarRegistrationPaidAction,
  publishSeminarAction, revertSeminarToDraftAction, updateSeminarAction,
} from '../actions';

const STATUS_LABELS: Record<string, string> = { canceled: 'Canceled', draft: 'Draft', published: 'Published' };

export default async function EditSeminarPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const { id } = await params;
  const query = await searchParams;
  const [seminar, paymentMethods] = await Promise.all([getAdminSeminar(id), listEnabledSeminarPaymentMethods()]);
  if (!seminar) notFound();
  const { rows: registrations } = await listAdminSeminarRegistrations(id, query);
  const registeredCount = registrations.filter((row) => row.registration_status === 'registered').length;
  const availability = computeSeminarAvailability({
    activeRegistrationCount: registeredCount, capacity: Number(seminar.capacity),
    endsAtUtc: seminarEndsAtUtc({ endTime: String(seminar.end_time), seminarDate: String(seminar.seminar_date), timezone: String(seminar.timezone) }),
    registrationDeadline: seminar.registration_deadline as string, status: seminar.status as never,
  });
  const status = String(seminar.status);
  return (
    <main className="space-y-8 p-8">
      <Link className="underline" href="/admin/seminars">← Seminars</Link>
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{String(seminar.title)}</h1>
          <p className="text-muted-foreground">Status: <strong>{STATUS_LABELS[status]}</strong> · Availability: <strong>{AVAILABILITY_LABELS[availability]}</strong> · {registeredCount} / {String(seminar.capacity)} registered</p>
        </div>
        <a className="underline" href={`/api/admin/export/seminar-registrations?seminarId=${id}`}>Export registrations (CSV)</a>
      </header>

      <section className="grid gap-6 lg:grid-cols-[1fr_16rem]">
        <SeminarForm action={updateSeminarAction} submitLabel="Save changes">
          <input name="id" type="hidden" value={id} />
          <SeminarFieldset
            allowCanceled
            lockPriceAndMethod={registrations.length > 0}
            paymentMethods={paymentMethods}
            seminar={{
              capacity: Number(seminar.capacity), description: String(seminar.description), end_time: String(seminar.end_time),
              location: String(seminar.location), payment_method_canonical_id: String(seminar.payment_method_canonical_id),
              price_cents: Number(seminar.price_cents), registration_deadline: seminar.registration_deadline as string,
              seminar_date: String(seminar.seminar_date), start_time: String(seminar.start_time), status, timezone: String(seminar.timezone), title: String(seminar.title),
            }}
          />
        </SeminarForm>
        <aside className="space-y-4">
          <section className="rounded-lg border p-4">
            <h2 className="mb-3 font-semibold">Quick actions</h2>
            <div className="space-y-3">
              {status !== 'published' ? <SeminarForm action={publishSeminarAction} pendingLabel="Publishing" submitLabel="Publish"><input name="id" type="hidden" value={id} /></SeminarForm> : null}
              {status !== 'canceled' ? <SeminarForm action={cancelSeminarAction} pendingLabel="Canceling" submitLabel="Cancel seminar"><input name="id" type="hidden" value={id} /></SeminarForm> : null}
              {status !== 'draft' ? <SeminarForm action={revertSeminarToDraftAction} pendingLabel="Reverting" submitLabel="Move to draft"><input name="id" type="hidden" value={id} /></SeminarForm> : null}
            </div>
          </section>
        </aside>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Registrations</h2>
        <form className="mb-3 grid gap-3 md:grid-cols-3" method="get">
          <input className="border p-2" defaultValue={Array.isArray(query.q) ? query.q[0] : query.q} name="q" placeholder="Search member name or email" />
          <select className="border p-2" defaultValue={Array.isArray(query.registrationStatus) ? query.registrationStatus[0] : query.registrationStatus} name="registrationStatus">
            <option value="">Any registration status</option>
            <option value="registered">Registered</option>
            <option value="canceled">Canceled</option>
          </select>
          <button className="rounded bg-primary p-2 text-primary-foreground" type="submit">Filter</button>
        </form>
        {registrations.length === 0 ? <p>No registrations match these filters.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead><tr><th className="p-2">Member</th><th>Email</th><th>Status</th><th>Registered</th><th /></tr></thead>
              <tbody>
                {registrations.map((row) => (
                  <tr className="border-t" key={String(row.id)}>
                    <td className="p-2">{String(row.member_name)}</td>
                    <td>{String(row.member_email)}</td>
                    <td>{registrationDisplayLabel(row.registration_status as never, row.payment_status as never)}</td>
                    <td>{new Date(String(row.registered_at)).toLocaleString()}</td>
                    <td>
                      {row.payment_status !== 'paid' ? (
                        <SeminarForm action={markSeminarRegistrationPaidAction} pendingLabel="Saving" submitLabel="Mark paid">
                          <input name="seminarId" type="hidden" value={id} />
                          <input name="registrationId" type="hidden" value={String(row.id)} />
                        </SeminarForm>
                      ) : PAYMENT_STATUS_LABELS.paid}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
