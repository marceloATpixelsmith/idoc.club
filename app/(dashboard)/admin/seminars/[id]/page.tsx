import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ClipboardList, Download } from 'lucide-react';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';
import { Button } from '@/components/ui/button';
import { SeminarFieldset } from '@/components/seminars/seminar-fieldset';
import { SeminarForm } from '@/components/seminars/seminar-form';
import { getAdminSeminar, seminarEndsAtUtc } from '@/lib/seminars/seminars';
import { getSeminarRegistrationCounts } from '@/lib/seminars/registrations';
import { AVAILABILITY_LABELS, computeSeminarAvailability } from '@/lib/seminars/status';
import { updateSeminarAction } from '../actions';

const STATUS_LABELS: Record<string, string> = { canceled: 'Canceled', draft: 'Draft', published: 'Published' };

export default async function EditSeminarPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const { id } = await params;
  const seminar = await getAdminSeminar(id);
  if (!seminar) notFound();
  const { active: registeredCount, total: registeredTotal } = await getSeminarRegistrationCounts(id);
  const availability = computeSeminarAvailability({
    activeRegistrationCount: registeredCount, capacity: Number(seminar.capacity),
    endsAtUtc: seminarEndsAtUtc({ endDate: String(seminar.end_date), endTime: String(seminar.end_time), timezone: String(seminar.timezone) }),
    registrationDeadline: seminar.registration_deadline as string, status: seminar.status as never,
  });
  const status = String(seminar.status);
  return (
    <main className="space-y-8 py-8 px-5 lg:px-8">
      <Link className="underline" href="/admin/seminars">← Seminars</Link>
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-gold">{String(seminar.title)}</h1>
          <p className="text-muted-foreground">Status: <strong>{STATUS_LABELS[status]}</strong> · Availability: <strong>{AVAILABILITY_LABELS[availability]}</strong> · {registeredCount} registered ({registeredTotal} total)</p>
        </div>
        <div className="flex items-center gap-1">
          <Button asChild aria-label="View registrations" size="icon-sm" title="View this seminar's registrations" variant="ghost">
            <Link href={`/admin/seminars/registrations?seminarId=${id}`}><ClipboardList aria-hidden="true" /></Link>
          </Button>
          <Button asChild aria-label="Download registrations" size="icon-sm" title="Download this seminar's registrations" variant="ghost">
            <a download href={`/api/admin/export/seminar-registrations?seminarId=${id}`}><Download aria-hidden="true" /></a>
          </Button>
        </div>
      </header>

      <SeminarForm action={updateSeminarAction} submitLabel="Save changes">
        <input name="id" type="hidden" value={id} />
        <SeminarFieldset
          allowCanceled
          lockPrices={registeredTotal > 0}
          seminar={{
            capacity: Number(seminar.capacity), description: String(seminar.description), end_date: String(seminar.end_date),
            end_time: String(seminar.end_time), is_fei: Boolean(seminar.is_fei), location: String(seminar.location), member_price_cents: Number(seminar.member_price_cents),
            non_member_price_cents: Number(seminar.non_member_price_cents), registration_deadline: seminar.registration_deadline as string,
            start_date: String(seminar.start_date), start_time: String(seminar.start_time), status, timezone: String(seminar.timezone), title: String(seminar.title),
          }}
        />
      </SeminarForm>
    </main>
  );
}
