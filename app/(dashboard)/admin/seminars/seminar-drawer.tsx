import { notFound } from 'next/navigation';
import { AdminFormDrawer } from '@/components/admin/admin-form-drawer';
import { AdminFormSection } from '@/components/admin/admin-form-section';
import { SeminarFieldset } from '@/components/seminars/seminar-fieldset';
import { SeminarForm } from '@/components/seminars/seminar-form';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';
import { getAdminSeminar, seminarEndsAtUtc } from '@/lib/seminars/seminars';
import { getSeminarRegistrationCounts } from '@/lib/seminars/registrations';
import { AVAILABILITY_LABELS, computeSeminarAvailability } from '@/lib/seminars/status';
import { createSeminarAction, updateSeminarAction } from './actions';

const STATUS_LABELS: Record<string, string> = { canceled: 'Canceled', draft: 'Draft', published: 'Published' };

export async function AdminSeminarDrawer({ isNew = false, seminarId }: { isNew?: boolean; seminarId?: string }) {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);

  if (isNew) {
    return (
      <AdminFormDrawer closeHref="/admin/seminars" title="New seminar">
        <div className="space-y-4 px-5 py-6 lg:px-8">
          <SeminarForm action={createSeminarAction} submitLabel="Create seminar">
            <AdminFormSection title="Seminar details">
              <SeminarFieldset />
            </AdminFormSection>
          </SeminarForm>
        </div>
      </AdminFormDrawer>
    );
  }

  const seminar = seminarId ? await getAdminSeminar(seminarId) : null;
  if (!seminar) notFound();
  const { active: registeredCount, total: registeredTotal } = await getSeminarRegistrationCounts(seminarId);
  const availability = computeSeminarAvailability({
    activeRegistrationCount: registeredCount,
    capacity: Number(seminar.capacity),
    endsAtUtc: seminarEndsAtUtc({ endDate: String(seminar.end_date) }),
    registrationDeadline: seminar.registration_deadline as string,
    status: seminar.status as never,
  });
  const status = String(seminar.status);

  return (
    <AdminFormDrawer closeHref="/admin/seminars" title={String(seminar.title)}>
      <div className="space-y-4 px-5 py-6 lg:px-8">
        <SeminarForm action={updateSeminarAction} submitLabel="Save changes">
          <input name="id" type="hidden" value={seminarId} />
          <AdminFormSection title="Seminar details">
            <p className="text-sm text-muted-foreground">Status: <strong>{STATUS_LABELS[status]}</strong> · Availability: <strong>{AVAILABILITY_LABELS[availability]}</strong> · {registeredCount} registered ({registeredTotal} total)</p>
            <SeminarFieldset
              allowCanceled
              lockPrices={registeredTotal > 0}
              seminar={{
                accommodation_information: seminar.accommodation_information,
                application: seminar.application,
                capacity: Number(seminar.capacity),
                course_directors: seminar.course_directors,
                course_venue_information: seminar.course_venue_information,
                end_date: seminar.end_date,
                is_fei: Boolean(seminar.is_fei),
                language: seminar.language,
                levels: seminar.levels ?? [],
                location: String(seminar.location),
                member_price_cents: Number(seminar.member_price_cents),
                non_member_price_cents: Number(seminar.non_member_price_cents),
                organizing_national_federation: seminar.organizing_national_federation,
                participant_profile: seminar.participant_profile,
                registration_deadline: seminar.registration_deadline as string,
                start_date: seminar.start_date,
                status,
                title: String(seminar.title),
              }}
            />
          </AdminFormSection>
        </SeminarForm>
      </div>
    </AdminFormDrawer>
  );
}
