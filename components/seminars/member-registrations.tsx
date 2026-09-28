import Link from 'next/link';
import { SeminarForm } from '@/components/seminars/seminar-form';
import { getUser } from '@/lib/db/queries';
import { isEntitled } from '@/lib/membership/entitlement';
import { getOwnPrivateMember } from '@/lib/membership/data-access';
import { sanitizeBankInstructions } from '@/lib/organization/format';
import { getSeminarPaymentMethodInstructions, listCurrentSeminarsForMember, listEnabledSeminarPaymentMethods, listPastSeminarsForMember } from '@/lib/seminars/registrations';
import { registrationDisplayLabel, type PaymentStatus, type RegistrationStatus } from '@/lib/seminars/status';
import { cancelSeminarRegistrationAction, registerForSeminarAction } from '@/app/(dashboard)/dashboard/seminars/actions';
import { registerAsGuestForSeminarAction } from '@/app/(marketing)/seminars/actions';

const money = (cents: number) => cents > 0 ? new Intl.NumberFormat('en-IE', { currency: 'EUR', style: 'currency' }).format(cents / 100) : 'No fee';

/** Same-day seminars show one date/time; a seminar spanning multiple days shows both ends of the
 * range instead, per docs/08's multi-day requirement. */
function formatSchedule(seminar: { end_date: string; end_time: string; start_date: string; start_time: string }) {
  const startTime = seminar.start_time.slice(0, 5);
  const endTime = seminar.end_time.slice(0, 5);
  return seminar.start_date === seminar.end_date
    ? `${seminar.start_date} · ${startTime}–${endTime}`
    : `${seminar.start_date} ${startTime} – ${seminar.end_date} ${endTime}`;
}

function PaymentMethodField({ methods }: { methods: Array<{ canonical_id: unknown; display_label: unknown }> }) {
  return <label className="block text-sm">Payment method
    <select className="mt-1 block w-full rounded-md border border-input bg-transparent p-2 text-sm" name="paymentMethod" required>
      {methods.map((method) => <option key={String(method.canonical_id)} value={String(method.canonical_id)}>{String(method.display_label)}</option>)}
    </select>
  </label>;
}

/** "Available Seminars": the database-backed catalog of upcoming, published seminars this member
 * has not yet registered for -- the real registration entry point (SeminarForm/registerForSeminarAction),
 * as opposed to the static marketing content shown to signed-out visitors. A logged-in member only
 * ever sees and pays the member price (docs/08). */
async function AvailableSeminars({ profileId }: { profileId: number }) {
  const [seminars, paymentMethods] = await Promise.all([listCurrentSeminarsForMember(profileId), listEnabledSeminarPaymentMethods()]);
  const notRegistered = seminars.filter((seminar) => seminar.registration_status === null);
  const available = notRegistered.filter((seminar) => seminar.availability === 'open');
  const other = notRegistered.filter((seminar) => !available.includes(seminar));
  const card = (seminar: (typeof seminars)[number]) => <li className="card-midnight p-6" key={seminar.id}>
    <h3 className="text-xl">{seminar.title}</h3>
    <p className="mt-2 text-xs uppercase tracking-[0.12em] text-muted-foreground">{formatSchedule(seminar)} · {seminar.location}</p>
    <p className="mt-2 text-sm font-medium">{money(seminar.member_price_cents)}</p>
    <div className="mt-3">
      <SeminarForm action={registerForSeminarAction} pendingLabel="Registering" submitLabel="Register">
        <input name="seminarId" type="hidden" value={seminar.id} />
        <PaymentMethodField methods={paymentMethods} />
      </SeminarForm>
    </div>
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
    <p className="mt-2 text-xs uppercase tracking-[0.12em] text-muted-foreground">{formatSchedule(seminar)} · {seminar.location}</p>
    <p className="mt-2 text-sm font-medium">{money(seminar.member_price_cents)}</p>
    <div className="mt-3">
      <p className="text-sm">Your registration: <strong>{registrationDisplayLabel(seminar.registration_status as RegistrationStatus, (seminar.payment_status ?? 'unpaid') as PaymentStatus)}</strong></p>
      {seminar.payment_status === 'bank_transfer_pending' && bankInstructionsHtml ? <div className="mt-2 rounded border p-3 text-sm" dangerouslySetInnerHTML={{ __html: bankInstructionsHtml }} /> : null}
      {seminar.payment_status === 'cash_pending' ? <p className="mt-2 text-sm">Pay in cash at the event.</p> : null}
      {!past && seminar.registration_status === 'registered' ? <SeminarForm action={cancelSeminarRegistrationAction} pendingLabel="Canceling" submitLabel="Cancel registration"><input name="seminarId" type="hidden" value={seminar.id} /></SeminarForm> : null}
    </div>
  </li>;

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
 * (docs/08). Registering offers two explicit paths: join for the member price, or register as a
 * guest at the non-member price -- true anonymous checkout, no account required. */
export async function PublicSeminarsCatalog() {
  const [seminars, paymentMethods] = await Promise.all([listCurrentSeminarsForMember(null), listEnabledSeminarPaymentMethods()]);
  const card = (seminar: (typeof seminars)[number]) => <li className="card-midnight p-6" key={seminar.id}>
    <h3 className="text-xl">{seminar.title}</h3>
    <p className="mt-2 text-xs uppercase tracking-[0.12em] text-muted-foreground">{formatSchedule(seminar)} · {seminar.location}</p>
    <p className="mt-2 text-sm font-medium">Members: {money(seminar.member_price_cents)} · Non-members: {money(seminar.non_member_price_cents)}</p>
    {seminar.availability === 'open' ? (
      <details className="mt-4">
        <summary className="cursor-pointer text-sm underline">Register</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div className="rounded border p-4">
            <p className="text-sm font-semibold">Join IDOC</p>
            <p className="mt-1 text-sm text-muted-foreground">Become a member to unlock the {money(seminar.member_price_cents)} member price and register.</p>
            <Link className="mt-3 inline-block underline" href="/sign-up">Join to get member pricing</Link>
          </div>
          <div className="rounded border p-4">
            <p className="text-sm font-semibold">Continue as a guest</p>
            <p className="mt-1 text-sm text-muted-foreground">Register now at the non-member price of {money(seminar.non_member_price_cents)}. No account required.</p>
            <SeminarForm action={registerAsGuestForSeminarAction} pendingLabel="Registering" submitLabel="Register as guest">
              <input name="seminarId" type="hidden" value={seminar.id} />
              <label className="block text-sm">Full name<input className="mt-1 block w-full rounded-md border border-input bg-transparent p-2 text-sm" maxLength={200} name="name" required /></label>
              <label className="block text-sm">Email<input className="mt-1 block w-full rounded-md border border-input bg-transparent p-2 text-sm" maxLength={255} name="email" required type="email" /></label>
              <PaymentMethodField methods={paymentMethods} />
            </SeminarForm>
          </div>
        </div>
      </details>
    ) : <p className="mt-3 text-sm text-muted-foreground"><Link className="underline" href="/sign-in">Log in</Link> as an active member for more options.</p>}
  </li>;

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
  if (!member || !isEntitled(member.entitlement, new Date().toISOString().slice(0, 10))) {
    return <section className="mt-12 border border-border bg-surface/50 p-6" aria-labelledby="my-registrations-heading"><h2 className="text-xl" id="my-registrations-heading">My seminar registrations</h2><p className="mt-2 text-sm text-muted-foreground">An active membership is required to view registrations.</p></section>;
  }

  return view === 'available' ? <AvailableSeminars profileId={member.profile.id} /> : <MySeminars profileId={member.profile.id} tab={tab} />;
}
