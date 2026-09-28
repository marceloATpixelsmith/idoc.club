import Link from 'next/link';
import { SeminarForm } from '@/components/seminars/seminar-form';
import { getUser } from '@/lib/db/queries';
import { getOwnPrivateMember } from '@/lib/membership/data-access';
import { sanitizeBankInstructions } from '@/lib/organization/format';
import { formatSchedule, money } from '@/lib/seminars/format';
import { getSeminarPaymentMethodInstructions, listCurrentSeminarsForMember, listPastSeminarsForMember } from '@/lib/seminars/registrations';
import { registrationDisplayLabel, type PaymentStatus, type RegistrationStatus } from '@/lib/seminars/status';
import { cancelSeminarRegistrationAction } from '@/app/(dashboard)/dashboard/seminars/actions';

/** "Available Seminars": the database-backed catalog of upcoming, published seminars this member
 * has not yet registered for. Each card is a single clickable link to that seminar's own detail
 * page (/seminars/[id]), where the actual registration form lives -- the listing itself is just a
 * scannable summary, not a form. */
async function AvailableSeminars({ profileId }: { profileId: number }) {
  const seminars = await listCurrentSeminarsForMember(profileId);
  const notRegistered = seminars.filter((seminar) => seminar.registration_status === null);
  const available = notRegistered.filter((seminar) => seminar.availability === 'open');
  const other = notRegistered.filter((seminar) => !available.includes(seminar));
  const card = (seminar: (typeof seminars)[number]) => (
    <li key={seminar.id}>
      <Link className="card-midnight block cursor-pointer p-6" href={`/seminars/${seminar.id}`}>
        <h3 className="text-xl">{seminar.title}</h3>
        <p className="mt-2 text-xs uppercase tracking-[0.12em] text-muted-foreground">{formatSchedule(seminar)} · {seminar.location}</p>
        <p className="mt-2 text-sm font-medium">{money(seminar.member_price_cents)}</p>
      </Link>
    </li>
  );

  return <section className="mt-12 border-t border-border pt-10" aria-labelledby="available-seminars-heading">
    <h2 className="text-2xl" id="available-seminars-heading">Available seminars</h2>
    {available.length ? <ul className="mt-6 grid gap-6 sm:grid-cols-2">{available.map(card)}</ul> : <p className="mt-6 text-muted-foreground">There are no additional seminars available to you.</p>}
    {other.length ? <div className="mt-10"><h3 className="text-lg font-semibold">Other upcoming seminars</h3><ul className="mt-3 grid gap-6 sm:grid-cols-2">{other.map(card)}</ul></div> : null}
  </section>;
}

/** "My Seminars": this member's own registration history, current and past. Each card links to the
 * seminar's own detail page for the full picture, while the Cancel action stays right here as an
 * independently clickable overlay control (a stretched-link card can't itself contain a nested,
 * separately-clickable form without breaking either click target). */
async function MySeminars({ profileId, tab }: { profileId: number; tab?: string }) {
  const past = tab === 'past';
  const seminars = past ? await listPastSeminarsForMember(profileId) : await listCurrentSeminarsForMember(profileId);
  const registered = seminars.filter((seminar) => seminar.registration_status !== null);
  const needsBankInstructions = registered.some((seminar) => seminar.payment_method_canonical_id === 'bank_transfer' && seminar.payment_status === 'bank_transfer_pending');
  const bankInstructionsHtml = needsBankInstructions ? sanitizeBankInstructions((await getSeminarPaymentMethodInstructions('bank_transfer')) ?? '') : null;
  const card = (seminar: (typeof seminars)[number]) => (
    <li className="card-midnight relative p-6" key={seminar.id}>
      <Link className="absolute inset-0" href={`/seminars/${seminar.id}`}><span className="sr-only">View {seminar.title}</span></Link>
      <h3 className="text-xl">{seminar.title}</h3>
      <p className="mt-2 text-xs uppercase tracking-[0.12em] text-muted-foreground">{formatSchedule(seminar)} · {seminar.location}</p>
      <p className="mt-2 text-sm font-medium">{money(seminar.member_price_cents)}</p>
      <div className="relative z-10 mt-3">
        <p className="text-sm">Your registration: <strong>{registrationDisplayLabel(seminar.registration_status as RegistrationStatus, (seminar.payment_status ?? 'unpaid') as PaymentStatus)}</strong></p>
        {seminar.payment_status === 'bank_transfer_pending' && bankInstructionsHtml ? <div className="mt-2 rounded border p-3 text-sm" dangerouslySetInnerHTML={{ __html: bankInstructionsHtml }} /> : null}
        {seminar.payment_status === 'cash_pending' ? <p className="mt-2 text-sm">Pay in cash at the event.</p> : null}
        {!past && seminar.registration_status === 'registered' ? <SeminarForm action={cancelSeminarRegistrationAction} pendingLabel="Canceling" submitLabel="Cancel registration"><input name="seminarId" type="hidden" value={seminar.id} /></SeminarForm> : null}
      </div>
    </li>
  );

  return <section className="mt-12 border-t border-border pt-10" aria-labelledby="my-registrations-heading">
    <h2 className="text-2xl" id="my-registrations-heading">My seminar registrations</h2>
    <nav aria-label="Registration history" className="mt-4 flex gap-4 border-b border-border"><Link className={`pb-2 text-xs uppercase tracking-[0.14em] ${past ? 'text-muted-foreground' : 'border-b-2 border-gold'}`} href="/seminars?view=my">Upcoming &amp; current</Link><Link className={`pb-2 text-xs uppercase tracking-[0.14em] ${past ? 'border-b-2 border-gold' : 'text-muted-foreground'}`} href="/seminars?view=my&tab=past">Past</Link></nav>
    <div className="mt-6">
      <h3 className="text-lg font-semibold">Your upcoming and current registrations</h3>
      {registered.length ? <ul className="mt-3 grid gap-6 sm:grid-cols-2">{registered.map(card)}</ul> : <p className="mt-3 text-muted-foreground">{past ? 'You have no past seminar registrations.' : 'You have no upcoming seminar registrations.'}</p>}
    </div>
  </section>;
}

/** The public seminar catalog for a signed-out visitor: the same real, published-seminar data as
 * AvailableSeminars, showing both the member and non-member price so the join incentive is clear
 * (docs/08). Each card links to that seminar's detail page, where registering offers two explicit
 * paths: join for the member price, or continue as a guest at the non-member price -- no account
 * required. */
export async function PublicSeminarsCatalog() {
  const seminars = await listCurrentSeminarsForMember(null);
  const card = (seminar: (typeof seminars)[number]) => (
    <li key={seminar.id}>
      <Link className="card-midnight block cursor-pointer p-6" href={`/seminars/${seminar.id}`}>
        <h3 className="text-xl">{seminar.title}</h3>
        <p className="mt-2 text-xs uppercase tracking-[0.12em] text-muted-foreground">{formatSchedule(seminar)} · {seminar.location}</p>
        <p className="mt-2 text-sm font-medium">Members: {money(seminar.member_price_cents)} · Non-members: {money(seminar.non_member_price_cents)}</p>
        {seminar.availability !== 'open' ? <p className="mt-3 text-sm text-muted-foreground">{'Registration is not currently open for this seminar.'}</p> : null}
      </Link>
    </li>
  );

  return <section className="mt-12" aria-labelledby="available-seminars-heading">
    <h2 className="text-2xl" id="available-seminars-heading">Available seminars</h2>
    {seminars.length ? <ul className="mt-6 grid gap-6 sm:grid-cols-2">{seminars.map(card)}</ul> : <p className="mt-6 text-muted-foreground">There are no seminars scheduled at this time.</p>}
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
  // "Available Seminars" is the default landing tab for every visitor, signed in or not (docs/08) --
  // a signed-in user with no member profile at all (an administrator, most commonly) sees the same
  // public, dual-priced catalog a signed-out visitor does, rather than being blocked entirely.
  if (view !== 'my') return member ? <AvailableSeminars profileId={member.profile.id} /> : <PublicSeminarsCatalog />;
  // "My Seminars" is this member's own registration history -- registration and payment status are
  // independent, durable facts (docs/02) that outlive a lapsed membership, so viewing them only
  // requires an actual profile to exist, never active entitlement. (Registering in the first place
  // still independently requires entitlement or administrator privilege -- see registerForSeminar.)
  if (!member) return <section className="mt-12 border border-border bg-surface/50 p-6" aria-labelledby="my-registrations-heading"><h2 className="text-xl" id="my-registrations-heading">My seminar registrations</h2><p className="mt-2 text-sm text-muted-foreground">A member profile is required to view registrations.</p></section>;
  return <MySeminars profileId={member.profile.id} tab={tab} />;
}
