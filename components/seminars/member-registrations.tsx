import Link from 'next/link';
import { SeminarForm } from '@/components/seminars/seminar-form';
import { getUser } from '@/lib/db/queries';
import { isEntitled } from '@/lib/membership/entitlement';
import { getOwnPrivateMember } from '@/lib/membership/data-access';
import { sanitizeBankInstructions } from '@/lib/organization/format';
import { getSeminarPaymentMethodInstructions, listCurrentSeminarsForMember, listPastSeminarsForMember } from '@/lib/seminars/registrations';
import { registrationDisplayLabel, type PaymentStatus, type RegistrationStatus } from '@/lib/seminars/status';
import { cancelSeminarRegistrationAction, registerForSeminarAction } from '@/app/(dashboard)/dashboard/seminars/actions';

function seminarMeta(seminar: { location: string; price_cents: number; seminar_date: string }) {
  return <>
    <p className="mt-2 text-xs uppercase tracking-[0.12em] text-muted-foreground">{seminar.seminar_date} · {seminar.location}</p>
    <p className="mt-2 text-sm font-medium">{seminar.price_cents > 0 ? new Intl.NumberFormat('en-IE', { currency: 'EUR', style: 'currency' }).format(seminar.price_cents / 100) : 'No fee'}</p>
  </>;
}

/** "Available Seminars": the database-backed catalog of upcoming, published seminars this member
 * has not yet registered for -- the real registration entry point (SeminarForm/registerForSeminarAction),
 * as opposed to the static marketing content shown to signed-out visitors. */
async function AvailableSeminars({ profileId }: { profileId: number }) {
  const seminars = await listCurrentSeminarsForMember(profileId);
  const notRegistered = seminars.filter((seminar) => seminar.registration_status === null);
  const available = notRegistered.filter((seminar) => seminar.availability === 'open');
  const other = notRegistered.filter((seminar) => !available.includes(seminar));
  const card = (seminar: (typeof seminars)[number]) => <li className="card-midnight p-6" key={seminar.id}>
    <h3 className="text-xl">{seminar.title}</h3>
    {seminarMeta(seminar)}
    <div className="mt-3"><SeminarForm action={registerForSeminarAction} pendingLabel="Registering" submitLabel="Register"><input name="seminarId" type="hidden" value={seminar.id} /></SeminarForm></div>
  </li>;

  return <section className="mt-12 border-t border-border pt-10" aria-labelledby="available-seminars-heading">
    <h2 className="text-2xl" id="available-seminars-heading">Available seminars</h2>
    {available.length ? <ul className="mt-6 grid gap-6 sm:grid-cols-2">{available.map(card)}</ul> : <p className="mt-6 text-muted-foreground">There are no additional seminars available to you.</p>}
    {other.length ? <div className="mt-10"><h3 className="text-lg font-semibold">Other upcoming seminars</h3><ul className="mt-3 grid gap-6 sm:grid-cols-2">{other.map(card)}</ul></div> : null}
  </section>;
}

/** "My Seminars": this member's own registration history, current and past. */
async function MySeminars({ profileId, tab }: { profileId: number; tab?: string }) {
  const past = tab === 'past';
  const seminars = past ? await listPastSeminarsForMember(profileId) : await listCurrentSeminarsForMember(profileId);
  const registered = seminars.filter((seminar) => seminar.registration_status !== null);
  const needsBankInstructions = registered.some((seminar) => seminar.payment_method_canonical_id === 'bank_transfer' && seminar.payment_status === 'bank_transfer_pending');
  const bankInstructionsHtml = needsBankInstructions ? sanitizeBankInstructions((await getSeminarPaymentMethodInstructions('bank_transfer')) ?? '') : null;
  const card = (seminar: (typeof seminars)[number]) => <li className="card-midnight p-6" key={seminar.id}>
    <h3 className="text-xl">{seminar.title}</h3>
    {seminarMeta(seminar)}
    <div className="mt-3">
      <p className="text-sm">Your registration: <strong>{registrationDisplayLabel(seminar.registration_status as RegistrationStatus, (seminar.payment_status ?? 'unpaid') as PaymentStatus)}</strong></p>
      {seminar.payment_status === 'bank_transfer_pending' && bankInstructionsHtml ? <div className="mt-2 rounded border p-3 text-sm" dangerouslySetInnerHTML={{ __html: bankInstructionsHtml }} /> : null}
      {seminar.payment_status === 'cash_pending' ? <p className="mt-2 text-sm">Pay in cash at the event.</p> : null}
      {!past && seminar.registration_status === 'registered' ? <SeminarForm action={cancelSeminarRegistrationAction} pendingLabel="Canceling" submitLabel="Cancel registration"><input name="seminarId" type="hidden" value={seminar.id} /></SeminarForm> : null}
    </div>
  </li>;

  return <section className="mt-12 border-t border-border pt-10" aria-labelledby="my-registrations-heading">
    <h2 className="text-2xl" id="my-registrations-heading">My seminar registrations</h2>
    <nav aria-label="Registration history" className="mt-4 flex gap-4 border-b border-border"><Link className={`pb-2 text-xs uppercase tracking-[0.14em] ${past ? 'text-muted-foreground' : 'border-b-2 border-gold'}`} href="/seminars">Upcoming &amp; current</Link><Link className={`pb-2 text-xs uppercase tracking-[0.14em] ${past ? 'border-b-2 border-gold' : 'text-muted-foreground'}`} href="/seminars?tab=past">Past</Link></nav>
    <div className="mt-6">
      <h3 className="text-lg font-semibold">Your upcoming and current registrations</h3>
      {registered.length ? <ul className="mt-3 grid gap-6 sm:grid-cols-2">{registered.map(card)}</ul> : <p className="mt-3 text-muted-foreground">{past ? 'You have no past seminar registrations.' : 'You have no upcoming seminar registrations.'}</p>}
    </div>
  </section>;
}

export async function MemberRegistrations({ tab, view }: { tab?: string; view?: string }) {
  const user = await getUser();
  if (!user) return null;

  let member: Awaited<ReturnType<typeof getOwnPrivateMember>> = null;
  try {
    member = await getOwnPrivateMember();
  } catch {
    // The public seminar catalog remains available, but protected registration data does not.
  }
  if (!member || !isEntitled(member.entitlement, new Date().toISOString().slice(0, 10))) {
    return <section className="mt-12 border border-border bg-surface/50 p-6" aria-labelledby="my-registrations-heading"><h2 className="text-xl" id="my-registrations-heading">My seminar registrations</h2><p className="mt-2 text-sm text-muted-foreground">An active membership is required to view registrations.</p></section>;
  }

  return view === 'available' ? <AvailableSeminars profileId={member.profile.id} /> : <MySeminars profileId={member.profile.id} tab={tab} />;
}
