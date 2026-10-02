import { CalendarDays, MapPin } from 'lucide-react';
import Link from 'next/link';
import { FeiBadge } from '@/components/seminars/fei-badge';
import { SeminarForm } from '@/components/seminars/seminar-form';
import { getUser } from '@/lib/db/queries';
import { getOwnPrivateMember } from '@/lib/membership/data-access';
import { isEntitled } from '@/lib/membership/entitlement';
import { formatSchedule, money } from '@/lib/seminars/format';
import { listCurrentSeminarsForMember, listPastPublishedSeminars, listPastSeminarsForMember } from '@/lib/seminars/registrations';
import { AVAILABILITY_LABELS, registrationDisplayLabel, type PaymentStatus, type RegistrationStatus } from '@/lib/seminars/status';
import { cancelSeminarRegistrationAction } from '@/app/(dashboard)/dashboard/seminars/actions';

/** A non-open seminar (full, or registration closed) still appears in the catalog -- it just carries
 * this small status tag instead of a register affordance, so a visitor understands why without a
 * second, separately-headed list to explain it. */
function AvailabilityTag({ availability }: { availability: keyof typeof AVAILABILITY_LABELS }) {
  if (availability === 'open') return null;
  return <span className="inline-block rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">{AVAILABILITY_LABELS[availability]}</span>;
}

/** Shared compact seminar card for the homepage and every public/member seminar listing. The
 * overlay link keeps the card navigable without nesting the independently clickable FEI link. */
export function SeminarListingCard({ children, href, seminar }: {
  children?: React.ReactNode; href: string;
  seminar: { end_date: string; is_fei: boolean; location: string; start_date: string; title: string };
}) {
  return (
    <article className="relative inline-grid max-w-full gap-5 py-6 sm:grid-cols-[minmax(0,max-content)_auto] sm:items-center sm:gap-10">
      <Link aria-label={`View ${seminar.title}`} className="absolute inset-0 z-10" href={href} />
      <div className="min-w-0">
        <h3 className="text-xl">{seminar.title}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
          <span className="inline-flex min-w-0 items-center gap-2"><MapPin aria-hidden className="size-3.5 shrink-0 text-gold" /><span className="break-words">{seminar.location}</span></span>
          <span className="inline-flex items-center gap-2"><CalendarDays aria-hidden className="size-3.5 shrink-0 text-gold" />{formatSchedule(seminar)}</span>
        </div>
        {children ? <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">{children}</div> : null}
      </div>
      {seminar.is_fei ? <div className="relative z-20 w-fit shrink-0"><FeiBadge className="h-4" /></div> : null}
    </article>
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
      <SeminarListingCard href={`/seminars/${seminar.id}`} seminar={seminar}>
        <p className="font-medium">{priceLine(seminar)}</p>
        <AvailabilityTag availability={seminar.availability} />
      </SeminarListingCard>
    </li>
  );

  return <section className="mt-10" aria-labelledby="available-seminars-heading">
    <h2 className="section-label" id="available-seminars-heading">Available seminars</h2>
    {upcoming.length ? <ul className="mt-6 w-fit max-w-full divide-y divide-border border-y border-border">{upcoming.map(row)}</ul> : <p className="mt-6 text-muted-foreground">There are no additional seminars available to you.</p>}
    {pastSeminars.length ? (
      <div className="mt-12">
        <h3 className="section-label">Past seminars</h3>
        <ul className="mt-4 w-fit max-w-full divide-y divide-border border-y border-border">{pastSeminars.map(row)}</ul>
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
  const paymentMethodLabel = (method: string | null) =>
    method === 'bank_transfer' ? 'Bank Transfer' : method === 'cash_event' ? 'Cash' : method === 'online_stripe' ? 'Online Payment' : null;
  const exceptionalPaymentStatuses = new Set<PaymentStatus>(['refunded', 'partially_refunded', 'refund_failed', 'disputed', 'chargeback']);
  const row = (seminar: (typeof seminars)[number]) => {
    const registrationStatus = seminar.registration_status as RegistrationStatus;
    const paymentStatus = (seminar.payment_status ?? 'unpaid') as PaymentStatus;
    const showExceptionalStatus = registrationStatus === 'canceled' || exceptionalPaymentStatuses.has(paymentStatus);
    return (
    <li key={seminar.id}>
      <SeminarListingCard href={`/seminars/${seminar.id}`} seminar={seminar}>
        <p className="font-medium">
          {money(seminar.expected_amount_cents ?? seminar.member_price_cents)}
          {seminar.payment_status === 'paid' ? ' (paid)' : ''}
        </p>
        {showExceptionalStatus ? (
          <p>Status: <strong>{registrationDisplayLabel(registrationStatus, paymentStatus)}</strong></p>
        ) : seminar.payment_status !== 'paid' && paymentMethodLabel(seminar.payment_method_canonical_id) ? (
          <p>Payment Method: <strong>{paymentMethodLabel(seminar.payment_method_canonical_id)}</strong></p>
        ) : null}
      </SeminarListingCard>
      {!past && seminar.registration_status === 'registered' ? <div className="pb-6"><SeminarForm action={cancelSeminarRegistrationAction} buttonClassName="h-8 rounded-md border-dashed px-3 font-normal" buttonTableControl pendingLabel="Canceling" submitLabel="Cancel registration"><input name="seminarId" type="hidden" value={seminar.id} /></SeminarForm></div> : null}
    </li>
    );
  };

  return <section className="mt-10" aria-labelledby="my-registrations-heading">
    <h2 className="text-2xl" id="my-registrations-heading">My seminar registrations</h2>
    <nav aria-label="Registration history" className="mt-4 flex gap-4 border-b border-border"><Link className={`pb-2 text-xs uppercase tracking-[0.14em] ${past ? 'text-muted-foreground' : 'border-b-2 border-gold'}`} href="/seminars?view=my">Upcoming &amp; current</Link><Link className={`pb-2 text-xs uppercase tracking-[0.14em] ${past ? 'border-b-2 border-gold' : 'text-muted-foreground'}`} href="/seminars?view=my&tab=past">Past</Link></nav>
    <div className="mt-6">
      {registered.length ? <ul className="w-fit max-w-full divide-y divide-border border-y border-border">{registered.map(row)}</ul> : <p className="text-muted-foreground">{past ? 'You have no past seminar registrations.' : 'You have no upcoming seminar registrations.'}</p>}
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
      <SeminarListingCard href={`/seminars/${seminar.id}`} seminar={seminar}>
        <p className="font-medium">Members: {money(seminar.member_price_cents)} · Non-members: {money(seminar.non_member_price_cents)}</p>
        <AvailabilityTag availability={seminar.availability} />
      </SeminarListingCard>
    </li>
  );

  return <section className="mt-10" aria-labelledby="available-seminars-heading">
    <h2 className="section-label" id="available-seminars-heading">Available seminars</h2>
    {seminars.length ? <ul className="mt-6 w-fit max-w-full divide-y divide-border border-y border-border">{seminars.map(row)}</ul> : <p className="mt-6 text-muted-foreground">There are no seminars scheduled at this time.</p>}
    {pastSeminars.length ? (
      <div className="mt-12">
        <h3 className="section-label">Past seminars</h3>
        <ul className="mt-4 w-fit max-w-full divide-y divide-border border-y border-border">{pastSeminars.map(row)}</ul>
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
