import Link from 'next/link';
import { SeminarForm } from '@/components/seminars/seminar-form';
import { getUser } from '@/lib/db/queries';
import { isEntitled } from '@/lib/membership/entitlement';
import { getOwnPrivateMember } from '@/lib/membership/data-access';
import { sanitizeBankInstructions } from '@/lib/organization/format';
import { getSeminarPaymentMethodInstructions, listCurrentSeminarsForMember, listPastSeminarsForMember } from '@/lib/seminars/registrations';
import { registrationDisplayLabel, type PaymentStatus, type RegistrationStatus } from '@/lib/seminars/status';
import { cancelSeminarRegistrationAction, registerForSeminarAction } from '@/app/(dashboard)/dashboard/seminars/actions';

export async function MemberRegistrations({ tab }: { tab?: string }) {
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

  const past = tab === 'past';
  const seminars = past ? await listPastSeminarsForMember(member.profile.id) : await listCurrentSeminarsForMember(member.profile.id);
  const registered = seminars.filter((seminar) => seminar.registration_status === 'registered');
  const available = seminars.filter((seminar) => seminar.registration_status === null && seminar.availability === 'open');
  const other = seminars.filter((seminar) => !registered.includes(seminar) && !available.includes(seminar));
  const needsBankInstructions = registered.some((seminar) => seminar.payment_method_canonical_id === 'bank_transfer' && seminar.payment_status === 'bank_transfer_pending');
  const bankInstructionsHtml = needsBankInstructions ? sanitizeBankInstructions((await getSeminarPaymentMethodInstructions('bank_transfer')) ?? '') : null;
  const card = (seminar: (typeof seminars)[number]) => <li className="card-midnight p-6" key={seminar.id}>
    <h3 className="text-xl">{seminar.title}</h3>
    <p className="mt-2 text-xs uppercase tracking-[0.12em] text-muted-foreground">{seminar.seminar_date} · {seminar.location}</p>
    <p className="mt-2 text-sm font-medium">{seminar.price_cents > 0 ? new Intl.NumberFormat('en-IE', { currency: 'EUR', style: 'currency' }).format(seminar.price_cents / 100) : 'No fee'}</p>
    {seminar.registration_status ? <div className="mt-3"><p className="text-sm">Your registration: <strong>{registrationDisplayLabel(seminar.registration_status as RegistrationStatus, (seminar.payment_status ?? 'unpaid') as PaymentStatus)}</strong></p>{seminar.payment_status === 'bank_transfer_pending' && bankInstructionsHtml ? <div className="mt-2 rounded border p-3 text-sm" dangerouslySetInnerHTML={{ __html: bankInstructionsHtml }} /> : null}{seminar.payment_status === 'cash_pending' ? <p className="mt-2 text-sm">Pay in cash at the event.</p> : null}{!past ? <SeminarForm action={cancelSeminarRegistrationAction} pendingLabel="Canceling" submitLabel="Cancel registration"><input name="seminarId" type="hidden" value={seminar.id} /></SeminarForm> : null}</div>
      : <SeminarForm action={registerForSeminarAction} pendingLabel="Registering" submitLabel="Register"><input name="seminarId" type="hidden" value={seminar.id} /></SeminarForm>}
  </li>;

  return <section className="mt-12 border-t border-border pt-10" aria-labelledby="my-registrations-heading">
    <h2 className="text-2xl" id="my-registrations-heading">My seminar registrations</h2>
    <nav aria-label="Registration history" className="mt-4 flex gap-4 border-b border-border"><Link className={`pb-2 text-xs uppercase tracking-[0.14em] ${past ? 'text-muted-foreground' : 'border-b-2 border-gold'}`} href="/seminars">Upcoming &amp; current</Link><Link className={`pb-2 text-xs uppercase tracking-[0.14em] ${past ? 'border-b-2 border-gold' : 'text-muted-foreground'}`} href="/seminars?tab=past">Past</Link></nav>
    {past ? registered.length ? <ul className="mt-6 grid gap-6 sm:grid-cols-2">{registered.map(card)}</ul> : <p className="mt-6 text-muted-foreground">You have no past seminar registrations.</p> : <div className="mt-6 space-y-10">
      <div><h3 className="text-lg font-semibold">Your upcoming and current registrations</h3>{registered.length ? <ul className="mt-3 grid gap-6 sm:grid-cols-2">{registered.map(card)}</ul> : <p className="mt-3 text-muted-foreground">You have no upcoming seminar registrations.</p>}</div>
      <div><h3 className="text-lg font-semibold">Available seminars</h3>{available.length ? <ul className="mt-3 grid gap-6 sm:grid-cols-2">{available.map(card)}</ul> : <p className="mt-3 text-muted-foreground">There are no additional seminars available to you.</p>}</div>
      {other.length ? <div><h3 className="text-lg font-semibold">Other upcoming seminars</h3><ul className="mt-3 grid gap-6 sm:grid-cols-2">{other.map(card)}</ul></div> : null}
    </div>}
  </section>;
}
