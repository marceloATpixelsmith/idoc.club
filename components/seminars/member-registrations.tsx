import { CalendarDays, MapPin } from 'lucide-react';
import Link from 'next/link';
import { FeiBadge } from '@/components/seminars/fei-badge';
import { SeminarForm } from '@/components/seminars/seminar-form';
import { getUser } from '@/lib/db/queries';
import { getOwnPrivateMember } from '@/lib/membership/data-access';
import { formatSchedule, money } from '@/lib/seminars/format';
import { listCurrentSeminarsForMember, listPastPublishedSeminars, listPastSeminarsForMember } from '@/lib/seminars/registrations';
import { APPROVAL_STATUS_LABELS, AVAILABILITY_LABELS, PAYMENT_STATUS_LABELS, type ApprovalStatus, type PaymentStatus, type RegistrationStatus } from '@/lib/seminars/status';
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


/** "Available seminars": the full database-backed catalog of upcoming published seminars, including
 * seminars this member is already registered for -- one flat list, open or not (a full/closed seminar still belongs
 * here, just tagged, rather than being split into a second, confusingly-named section). Each row is
 * a single clickable link to that seminar's own detail page (/seminars/[id]), where the actual
 * registration form lives -- the listing itself is just a scannable summary, not a form.
 */
async function AvailableSeminars({ profileId }: { profileId: number }) {
  const [seminars, pastSeminars] = await Promise.all([listCurrentSeminarsForMember(profileId), listPastPublishedSeminars()]);
  //SHOW THE COMPLETE CATALOG; REGISTRATION STATUS CONTROLS ONLY THE REGISTER CTA ON DETAIL PAGES.
  const priceLine = (seminar: (typeof seminars)[number]) => money(seminar.member_price_cents);
  const row = (seminar: (typeof seminars)[number]) => (
    <li key={seminar.id}>
      <SeminarListingCard href={`/seminars/${seminar.id}`} seminar={seminar}>
        <p className="font-medium">{priceLine(seminar)}</p>
        <AvailabilityTag availability={seminar.availability} />
      </SeminarListingCard>
    </li>
  );

  return <section className="mt-10" aria-labelledby="available-seminars-heading">
    <h2 className="section-label" id="available-seminars-heading">Available seminars/courses</h2>
    {seminars.length ? <ul className="mt-6 w-fit max-w-full divide-y divide-border border-y border-border">{seminars.map(row)}</ul> : <p className="mt-6 text-muted-foreground">There are no seminars/courses scheduled at this time.</p>}
    {pastSeminars.length ? (
      <div className="mt-12">
        <h3 className="section-label">Past seminars/courses</h3>
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
  const row = (seminar: (typeof seminars)[number]) => {
    const registrationStatus = seminar.registration_status as RegistrationStatus;
    const paymentStatus = (seminar.payment_status ?? 'unpaid') as PaymentStatus;
    const approvalStatus = (seminar.approval_status ?? 'confirmed') as ApprovalStatus;
    return (
    <li key={seminar.id}>
      <SeminarListingCard href={`/seminars/${seminar.id}`} seminar={seminar}>
        <p className="font-medium">{money(seminar.expected_amount_cents ?? seminar.member_price_cents)}</p>
        <p>Status: <strong>{registrationStatus === 'canceled' ? 'Canceled' : `${APPROVAL_STATUS_LABELS[approvalStatus]} / ${PAYMENT_STATUS_LABELS[paymentStatus]}`}</strong></p>
      </SeminarListingCard>
      {!past && seminar.registration_status === 'registered' ? <div className="pb-6"><SeminarForm action={cancelSeminarRegistrationAction} buttonClassName="h-8 rounded-md border-dashed px-3 font-normal" buttonTableControl pendingLabel="Canceling" submitLabel="Cancel registration"><input name="seminarId" type="hidden" value={seminar.id} /></SeminarForm></div> : null}
    </li>
    );
  };

  return <section aria-labelledby="my-registrations-heading">
    {/*//SUBNAV SITS IN A SOFT NAVY WASH, WITH THINNER GOLD INDICATOR THAN THE PARENT LEVEL.*/}
    <div className="bg-surface/45 pb-3 pt-4">
      <h2 className="sr-only" id="my-registrations-heading">My seminar/course registrations</h2>
      <nav aria-label="Registration history" className="flex flex-wrap items-center gap-x-7 gap-y-2">
        <Link
          aria-current={!past ? 'page' : undefined}
          className={`border-b-2 pb-1.5 text-sm tracking-[0.025em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold ${past ? 'border-transparent text-muted-foreground hover:text-foreground' : 'border-gold font-medium text-foreground'}`}
          href="/seminars?view=my"
        >Upcoming &amp; current</Link>
        <Link
          aria-current={past ? 'page' : undefined}
          className={`border-b-2 pb-1.5 text-sm tracking-[0.025em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold ${past ? 'border-gold font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          href="/seminars?view=my&tab=past"
        >Past</Link>
      </nav>
    </div>
    <div className="mt-8">
      {registered.length ? <ul className="w-fit max-w-full divide-y divide-border border-y border-border">{registered.map(row)}</ul> : <p className="text-muted-foreground">{past ? 'You have no past seminar/course registrations.' : 'You have no upcoming seminar/course registrations.'}</p>}
    </div>
  </section>;
}

/** The public seminar/course catalog for a signed-out visitor (or a signed-in account with no profile):
 * the same real, published data as AvailableSeminars, plus the "Past" archive. Each row links to the
 * detail page, which shows full details but offers no registration -- registering requires signing in
 * as an active member. */
export async function PublicSeminarsCatalog() {
  const [seminars, pastSeminars] = await Promise.all([listCurrentSeminarsForMember(null), listPastPublishedSeminars()]);
  const row = (seminar: (typeof seminars)[number]) => (
    <li key={seminar.id}>
      <SeminarListingCard href={`/seminars/${seminar.id}`} seminar={seminar}>
        <p className="font-medium">{money(seminar.member_price_cents)}</p>
        <AvailabilityTag availability={seminar.availability} />
      </SeminarListingCard>
    </li>
  );

  return <section className="mt-10" aria-labelledby="available-seminars-heading">
    <h2 className="section-label" id="available-seminars-heading">Available seminars/courses</h2>
    {seminars.length ? <ul className="mt-6 w-fit max-w-full divide-y divide-border border-y border-border">{seminars.map(row)}</ul> : <p className="mt-6 text-muted-foreground">There are no seminars/courses scheduled at this time.</p>}
    {pastSeminars.length ? (
      <div className="mt-12">
        <h3 className="section-label">Past seminars/courses</h3>
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
  // "Available Seminars/Courses" is the default landing tab for every visitor, signed in or not
  // (docs/08). A signed-in user with no member profile at all (an administrator, most commonly) sees
  // the same public catalog a signed-out visitor does rather than being blocked entirely. A profile
  // gets its own profile-scoped catalog for registration-aware detail navigation without hiding rows.
  if (view !== 'my') {
    if (!member) return <PublicSeminarsCatalog />;
    return <AvailableSeminars profileId={member.profile.id} />;
  }
  // "My Seminars" is this member's own registration history -- registration and payment status are
  // independent, durable facts (docs/02) that outlive a lapsed membership, so viewing them only
  // requires an actual profile to exist, never active entitlement. (Registering in the first place
  // still independently requires entitlement or administrator privilege -- see registerForSeminar.)
  if (!member) return <section className="mt-10 border border-border bg-surface/50 p-6" aria-labelledby="my-registrations-heading"><h2 className="text-xl" id="my-registrations-heading">My seminar/course registrations</h2><p className="mt-2 text-sm text-muted-foreground">A member profile is required to view registrations.</p></section>;
  return <MySeminars profileId={member.profile.id} tab={tab} />;
}
