import { CalendarDays, MapPin } from 'lucide-react';
import Link from 'next/link';
import { FeiBadge } from '@/components/seminars/fei-badge';
import { SeminarForm } from '@/components/seminars/seminar-form';
import { getUser } from '@/lib/db/queries';
import { getOwnPrivateMember } from '@/lib/membership/data-access';
import { isEntitled } from '@/lib/membership/entitlement';
import { sanitizeBankInstructions } from '@/lib/organization/format';
import { formatSchedule, money } from '@/lib/seminars/format';
import { getSeminarPaymentMethodInstructions, listCurrentSeminarsForMember, listPastPublishedSeminars, listPastSeminarsForMember } from '@/lib/seminars/registrations';
import { AVAILABILITY_LABELS, registrationDisplayLabel, type PaymentStatus, type RegistrationStatus } from '@/lib/seminars/status';
import { cancelSeminarRegistrationAction } from '@/app/(dashboard)/dashboard/seminars/actions';

/** A non-open seminar (full, or registration closed) still appears in the catalog -- it just carries
 * this small status tag instead of a register affordance, so a visitor understands why without a
 * second, separately-headed list to explain it. */
function AvailabilityTag({ availability }: { availability: keyof typeof AVAILABILITY_LABELS }) {
  if (availability === 'open') return null;
  return <span className="inline-block rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">{AVAILABILITY_LABELS[availability]}</span>;
}

/** One row of a seminar listing -- the same icon-row layout the homepage's Upcoming Seminars widget
 * already uses (title, then location/date with MapPin/CalendarDays icons in small uppercase tracked
 * text), so a seminar reads identically wherever it's listed on the site. `meta` renders whatever
 * else this particular list needs on the right (price, an availability tag, a registration-status
 * line, a Cancel action) -- everything that varies between Available Seminars, Past seminars, the
 * public catalog, and My Seminars. */
function SeminarRow({ children, seminar }: { children?: React.ReactNode; seminar: { end_date: string; end_time: string; is_fei: boolean; location: string; start_date: string; start_time: string; title: string } }) {
  return (
    <div className="flex flex-col gap-3 py-6 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 className="text-xl">{seminar.title}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-5 text-xs uppercase tracking-[0.14em] text-muted-foreground">
          <span className="inline-flex items-center gap-2"><MapPin className="size-3.5 text-gold" /> {seminar.location}</span>
          <span className="inline-flex items-center gap-2"><CalendarDays className="size-3.5 text-gold" />{formatSchedule(seminar)}</span>
        </div>
      </div>
      <div className="flex items-center gap-4 sm:flex-col sm:items-end sm:gap-2">
        {children}
        {seminar.is_fei ? <FeiBadge className="h-4" /> : null}
      </div>
    </div>
  );
}

/** "Available seminars": the database-backed catalog of upcoming, published seminars this member
 * has not yet registered for -- one flat list, open or not (a full/closed seminar still belongs
 * here, just tagged, rather than being split into a second, confusingly-named section). Each row is
 * a single clickable link to that seminar's own detail page (/seminars/[id]), where the actual
 * registration form lives -- the listing itself is just a scannable summary, not a form.
 * `showBothPrices` covers a signed-in profile that currently lacks entitlement (e.g. a lapsed
 * membership): the detail page routes them to guest/non-member pricing (only a currently entitled
 * member gets the member-price form), so the row must advertise the price they can actually pay
 * rather than always showing the member price they cannot get. */
async function AvailableSeminars({ profileId, showBothPrices }: { profileId: number; showBothPrices: boolean }) {
  const [seminars, pastSeminars] = await Promise.all([listCurrentSeminarsForMember(profileId), listPastPublishedSeminars()]);
  const upcoming = seminars.filter((seminar) => seminar.registration_status === null);
  const priceLine = (seminar: (typeof seminars)[number]) =>
    showBothPrices ? `Members: ${money(seminar.member_price_cents)} · Non-members: ${money(seminar.non_member_price_cents)}` : money(seminar.member_price_cents);
  const row = (seminar: (typeof seminars)[number]) => (
    <li key={seminar.id}>
      <Link className="block hover:opacity-90" href={`/seminars/${seminar.id}`}>
        <SeminarRow seminar={seminar}>
          <p className="text-sm font-medium">{priceLine(seminar)}</p>
          <AvailabilityTag availability={seminar.availability} />
        </SeminarRow>
      </Link>
    </li>
  );

  return <section className="mt-10" aria-labelledby="available-seminars-heading">
    <h2 className="text-2xl" id="available-seminars-heading">Available seminars</h2>
    {upcoming.length ? <ul className="mt-6 divide-y divide-border border-y border-border">{upcoming.map(row)}</ul> : <p className="mt-6 text-muted-foreground">There are no additional seminars available to you.</p>}
    {pastSeminars.length ? (
      <div className="mt-12">
        <h3 className="text-lg font-semibold text-foreground">Past seminars</h3>
        <ul className="mt-4 divide-y divide-border border-y border-border">{pastSeminars.map(row)}</ul>
      </div>
    ) : null}
  </section>;
}

/** "My Seminars": this member's own registration history, current and past. Each row links to the
 * seminar's own detail page for the full picture, while the Cancel action stays right here as an
 * independently clickable overlay control (a stretched-link row can't itself contain a nested,
 * separately-clickable form without breaking either click target). */
async function MySeminars({ profileId, tab }: { profileId: number; tab?: string }) {
  const past = tab === 'past';
  const seminars = past ? await listPastSeminarsForMember(profileId) : await listCurrentSeminarsForMember(profileId);
  const registered = seminars.filter((seminar) => seminar.registration_status !== null);
  const needsBankInstructions = registered.some((seminar) => seminar.payment_method_canonical_id === 'bank_transfer' && seminar.payment_status === 'bank_transfer_pending');
  const bankInstructionsHtml = needsBankInstructions ? sanitizeBankInstructions((await getSeminarPaymentMethodInstructions('bank_transfer')) ?? '') : null;
  const row = (seminar: (typeof seminars)[number]) => (
    <li className="relative py-6" key={seminar.id}>
      <Link className="absolute inset-0" href={`/seminars/${seminar.id}`}><span className="sr-only">View {seminar.title}</span></Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-xl">{seminar.title}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-5 text-xs uppercase tracking-[0.14em] text-muted-foreground">
            <span className="inline-flex items-center gap-2"><MapPin className="size-3.5 text-gold" /> {seminar.location}</span>
            <span className="inline-flex items-center gap-2"><CalendarDays className="size-3.5 text-gold" />{formatSchedule(seminar)}</span>
          </div>
          <p className="mt-2 text-sm">Your registration: <strong>{registrationDisplayLabel(seminar.registration_status as RegistrationStatus, (seminar.payment_status ?? 'unpaid') as PaymentStatus)}</strong></p>
          {seminar.payment_status === 'bank_transfer_pending' && bankInstructionsHtml ? <div className="mt-2 rounded border p-3 text-sm" dangerouslySetInnerHTML={{ __html: bankInstructionsHtml }} /> : null}
          {seminar.payment_status === 'cash_pending' ? <p className="mt-2 text-sm">Pay in cash at the event.</p> : null}
        </div>
        <div className="flex items-center gap-4 sm:flex-col sm:items-end sm:gap-2">
          <p className="text-sm font-medium">{money(seminar.member_price_cents)}</p>
          {seminar.is_fei ? <FeiBadge className="h-4" /> : null}
        </div>
      </div>
      {!past && seminar.registration_status === 'registered' ? (
        <div className="relative z-10 mt-3">
          <SeminarForm action={cancelSeminarRegistrationAction} pendingLabel="Canceling" submitLabel="Cancel registration"><input name="seminarId" type="hidden" value={seminar.id} /></SeminarForm>
        </div>
      ) : null}
    </li>
  );

  return <section className="mt-10" aria-labelledby="my-registrations-heading">
    <h2 className="text-2xl" id="my-registrations-heading">My seminar registrations</h2>
    <nav aria-label="Registration history" className="mt-4 flex gap-4 border-b border-border"><Link className={`pb-2 text-xs uppercase tracking-[0.14em] ${past ? 'text-muted-foreground' : 'border-b-2 border-gold'}`} href="/seminars?view=my">Upcoming &amp; current</Link><Link className={`pb-2 text-xs uppercase tracking-[0.14em] ${past ? 'border-b-2 border-gold' : 'text-muted-foreground'}`} href="/seminars?view=my&tab=past">Past</Link></nav>
    <div className="mt-6">
      {registered.length ? <ul className="divide-y divide-border border-y border-border">{registered.map(row)}</ul> : <p className="text-muted-foreground">{past ? 'You have no past seminar registrations.' : 'You have no upcoming seminar registrations.'}</p>}
    </div>
  </section>;
}

/** The public seminar catalog for a signed-out visitor: the same real, published-seminar data as
 * AvailableSeminars, showing both the member and non-member price so the join incentive is clear
 * (docs/08), plus the same "Past seminars" archive. Each row links to that seminar's detail page,
 * where registering offers two explicit paths: join for the member price, or continue as a guest at
 * the non-member price -- no account required. */
export async function PublicSeminarsCatalog() {
  const [seminars, pastSeminars] = await Promise.all([listCurrentSeminarsForMember(null), listPastPublishedSeminars()]);
  const row = (seminar: (typeof seminars)[number]) => (
    <li key={seminar.id}>
      <Link className="block hover:opacity-90" href={`/seminars/${seminar.id}`}>
        <SeminarRow seminar={seminar}>
          <p className="text-sm font-medium">Members: {money(seminar.member_price_cents)} · Non-members: {money(seminar.non_member_price_cents)}</p>
          <AvailabilityTag availability={seminar.availability} />
        </SeminarRow>
      </Link>
    </li>
  );

  return <section className="mt-10" aria-labelledby="available-seminars-heading">
    <h2 className="text-2xl" id="available-seminars-heading">Available seminars</h2>
    {seminars.length ? <ul className="mt-6 divide-y divide-border border-y border-border">{seminars.map(row)}</ul> : <p className="mt-6 text-muted-foreground">There are no seminars scheduled at this time.</p>}
    {pastSeminars.length ? (
      <div className="mt-12">
        <h3 className="text-lg font-semibold text-foreground">Past seminars</h3>
        <ul className="mt-4 divide-y divide-border border-y border-border">{pastSeminars.map(row)}</ul>
      </div>
    ) : null}
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
  // public, dual-priced catalog a signed-out visitor does, rather than being blocked entirely. A
  // profile that currently lacks entitlement (a lapsed membership) still gets its own profile-scoped
  // catalog (so seminars it's already registered for are correctly excluded), but with both prices
  // shown -- the detail page routes it to guest/non-member pricing, same as no profile at all.
  if (view !== 'my') {
    if (!member) return <PublicSeminarsCatalog />;
    const entitled = isEntitled(member.entitlement, new Date().toISOString().slice(0, 10));
    return <AvailableSeminars profileId={member.profile.id} showBothPrices={!entitled} />;
  }
  // "My Seminars" is this member's own registration history -- registration and payment status are
  // independent, durable facts (docs/02) that outlive a lapsed membership, so viewing them only
  // requires an actual profile to exist, never active entitlement. (Registering in the first place
  // still independently requires entitlement or administrator privilege -- see registerForSeminar.)
  if (!member) return <section className="mt-10 border border-border bg-surface/50 p-6" aria-labelledby="my-registrations-heading"><h2 className="text-xl" id="my-registrations-heading">My seminar registrations</h2><p className="mt-2 text-sm text-muted-foreground">A member profile is required to view registrations.</p></section>;
  return <MySeminars profileId={member.profile.id} tab={tab} />;
}
