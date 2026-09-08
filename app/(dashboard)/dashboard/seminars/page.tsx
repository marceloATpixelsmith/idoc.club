import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getOwnPrivateMember, requireAccountAccess } from '@/lib/membership/data-access';
import { isPrivilegedActor } from '@/lib/membership/account-access';
import { isEntitled } from '@/lib/membership/entitlement';
import { getUser } from '@/lib/db/queries';
import { sanitizeBankInstructions } from '@/lib/organization/format';
import { SeminarForm } from '@/components/seminars/seminar-form';
import { getSeminarPaymentMethodInstructions, listCurrentSeminarsForMember, listPastSeminarsForMember } from '@/lib/seminars/registrations';
import { AVAILABILITY_LABELS, registrationDisplayLabel, type PaymentStatus, type RegistrationStatus, type SeminarAvailability } from '@/lib/seminars/status';
import { cancelSeminarRegistrationAction, registerForSeminarAction } from './actions';

export default async function SeminarsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await getUser();
  if (user?.accountState === 'onboarding') redirect('/dashboard');
  const actor = await requireAccountAccess('profile');
  const privileged = isPrivilegedActor(actor);
  const member = await getOwnPrivateMember();
  // An administrator/super_admin is never a member and must never be gated by membership payment
  // status or pushed into onboarding for lacking a member profile.
  if (!member && !privileged) redirect('/dashboard');
  if (member && !privileged && !isEntitled(member.entitlement, new Date().toISOString().slice(0, 10))) redirect('/dashboard');
  const profileId = member?.profile.id ?? null;

  const { tab } = await searchParams;
  const activeTab = tab === 'past' ? 'past' : 'current';
  const seminars = activeTab === 'current'
    ? await listCurrentSeminarsForMember(profileId)
    : profileId ? await listPastSeminarsForMember(profileId) : [];

  const needsBankInstructions = seminars.some((seminar) =>
    seminar.payment_method_canonical_id === 'bank_transfer' && seminar.registration_status === 'registered' && seminar.payment_status === 'bank_transfer_pending');
  const bankInstructionsHtml = needsBankInstructions ? sanitizeBankInstructions((await getSeminarPaymentMethodInstructions('bank_transfer')) ?? '') : null;

  return (
    <main className="flex-1 py-4 lg:py-8 px-5 lg:px-8">
      <h1 className="text-2xl font-semibold">My Seminars</h1>
      <nav className="mt-4 flex gap-4 border-b border-border">
        <Link className={`pb-2 uppercase tracking-[0.14em] text-xs ${activeTab === 'current' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground'}`} href="/dashboard/seminars">Current</Link>
        <Link className={`pb-2 uppercase tracking-[0.14em] text-xs ${activeTab === 'past' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground'}`} href="/dashboard/seminars?tab=past">Past</Link>
      </nav>
      {seminars.length === 0 ? (
        <p className="mt-6 text-muted-foreground">{activeTab === 'current' ? 'There are no current seminars.' : 'You have no past seminar registrations.'}</p>
      ) : (
        <ul className="mt-6 space-y-6">
          {seminars.map((seminar) => {
            const registrationStatus = seminar.registration_status as RegistrationStatus | null;
            const paymentStatus = seminar.payment_status as PaymentStatus | null;
            const availability = seminar.availability as SeminarAvailability;
            return (
              <li className="rounded-lg border p-4" key={String(seminar.id)}>
                <h2 className="text-lg font-semibold">{String(seminar.title)}</h2>
                <p className="text-sm text-muted-foreground">
                  {String(seminar.seminar_date)} · {String(seminar.start_time).slice(0, 5)}–{String(seminar.end_time).slice(0, 5)} ({String(seminar.timezone)})
                </p>
                <p className="mt-1 text-sm">{String(seminar.location)}</p>
                <p className="mt-1 text-sm">€{(Number(seminar.price_cents) / 100).toFixed(2)}</p>
                <p className="mt-2 font-medium">{AVAILABILITY_LABELS[availability]}</p>
                {registrationStatus ? (
                  <div className="mt-3 space-y-2">
                    <p className="text-sm">Your registration: <strong>{registrationDisplayLabel(registrationStatus, paymentStatus ?? 'unpaid')}</strong></p>
                    {registrationStatus === 'registered' && paymentStatus === 'bank_transfer_pending' && bankInstructionsHtml ? (
                      // eslint-disable-next-line react/no-danger -- pre-sanitized by lib/organization/format.ts's sanitizeBankInstructions at write time and re-sanitized here before render.
                      <div className="rounded border p-3 text-sm" dangerouslySetInnerHTML={{ __html: bankInstructionsHtml }} />
                    ) : null}
                    {registrationStatus === 'registered' && paymentStatus === 'cash_pending' ? <p className="text-sm">Pay in cash at the event.</p> : null}
                    {registrationStatus === 'registered' && availability !== 'past' ? (
                      <SeminarForm action={cancelSeminarRegistrationAction} pendingLabel="Canceling" submitLabel="Cancel registration">
                        <input name="seminarId" type="hidden" value={String(seminar.id)} />
                      </SeminarForm>
                    ) : null}
                  </div>
                ) : availability === 'open' && profileId ? (
                  <div className="mt-3">
                    <SeminarForm action={registerForSeminarAction} pendingLabel="Registering" submitLabel="Register">
                      <input name="seminarId" type="hidden" value={String(seminar.id)} />
                    </SeminarForm>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
