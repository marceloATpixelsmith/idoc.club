import { Banknote, Calendar, CalendarClock, Languages, Layers, MapPin, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FeiBadge } from '@/components/seminars/fei-badge';
import { SeminarRegisterCta } from '@/components/seminars/seminar-register-cta';
import { PageHeader } from '@/components/site/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { BackLink } from '@/components/ui/back-link';
import { FlashBanner } from '@/components/ui/flash-banner';
import { getUser } from '@/lib/db/queries';
import { getOwnPrivateMember } from '@/lib/membership/data-access';
import { isEntitled } from '@/lib/membership/entitlement';
import { languageNameForTag } from '@/lib/seminars/language';
import { formatDate, formatLevels, formatSchedule, money } from '@/lib/seminars/format';
import { getSeminarForRegistrant, listEnabledSeminarPaymentMethods } from '@/lib/seminars/registrations';
import { AVAILABILITY_LABELS } from '@/lib/seminars/status';
import { sanitizeArticleContent } from '@/lib/news/sanitize';
import { readUiFlash } from '@/lib/ui/flash-state';

function InfoRow({ children, icon: Icon }: { children: React.ReactNode; icon: typeof Calendar }) {
  return (
    <div className="flex items-center gap-4 p-5">
      <Icon aria-hidden className="h-5 w-5 shrink-0 text-gold" />
      <p className="text-base">{children}</p>
    </div>
  );
}

export const dynamic = 'force-dynamic';

async function ownMember() {
  try {
    return await getOwnPrivateMember();
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const member = await ownMember();
  const seminar = await getSeminarForRegistrant(id, member?.profile.id ?? null);
  if (!seminar) return { title: 'Seminar — IDOC' };
  return {
    description: `${formatSchedule(seminar)} · ${seminar.location}`,
    title: `${seminar.title} — IDOC Seminars/Courses`,
  };
}

export default async function SeminarDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const flash = await readUiFlash(`/seminars/${id}`);
  const [user, member] = await Promise.all([getUser(), ownMember()]);
  const seminar = await getSeminarForRegistrant(id, member?.profile.id ?? null);
  if (!seminar) notFound();

  const paymentMethods = await listEnabledSeminarPaymentMethods();
  const alreadyRegistered = seminar.registration_status !== null;
  // Registration is members-only: only a signed-in, currently entitled member is offered the Register
  // action. Everyone else (signed out, or signed in without current entitlement) still sees the full
  // seminar/course details, but never a registration affordance -- the server re-checks all of this.
  const isEntitledMember = Boolean(member && isEntitled(member.entitlement, new Date().toISOString().slice(0, 10)));
  const isSignedIn = Boolean(user);
  const dateRange = seminar.start_date === seminar.end_date
    ? formatDate(seminar.start_date)
    : `${formatDate(seminar.start_date)} – ${formatDate(seminar.end_date)}`;
  const deadlineDate = formatDate(new Date(seminar.registration_deadline).toISOString().slice(0, 10));
  const levelsLabel = formatLevels(seminar.levels);

  return (
    <>
      <PageHeader eyebrow="Seminar/Course" intro={`${formatSchedule(seminar)} · ${seminar.location}`} title={seminar.title} />
      <div className="mx-auto max-w-7xl px-5 pb-16 lg:px-8">
        <BackLink href="/seminars">Back to Seminars/Courses</BackLink>
        {flash === 'seminar-checkout-canceled' ? (
          <FlashBanner targetPath={`/seminars/${id}`}>Online payment was canceled. No payment was taken.</FlashBanner>
        ) : null}

        {/* Details + Register come first in the markup -- and so first on mobile and on the left on
          * desktop -- since that's what a visitor actually came here to do. The long description
          * reads second, as supporting material rather than a wall of text blocking the CTA. */}
        <div className="grid gap-6 lg:grid-cols-[2fr_3fr]">
          <div className="space-y-6">
            <Card className="py-0">
              <CardContent className="space-y-0 p-0">
                <div className="divide-y divide-border">
                  <InfoRow icon={Calendar}>{dateRange}</InfoRow>
                  <InfoRow icon={MapPin}>{seminar.location}</InfoRow>
                  <InfoRow icon={Languages}>Language: {languageNameForTag(seminar.language)}</InfoRow>
                  <InfoRow icon={Users}>Number of participants: {seminar.capacity}</InfoRow>
                  <InfoRow icon={Banknote}>Price: {money(seminar.member_price_cents)}</InfoRow>
                  {levelsLabel ? <InfoRow icon={Layers}>{levelsLabel}</InfoRow> : null}
                  <InfoRow icon={CalendarClock}>Registration deadline: {deadlineDate}</InfoRow>
                </div>
                {seminar.is_fei ? <div className="border-t border-border p-5"><FeiBadge className="h-6" /></div> : null}
              </CardContent>
            </Card>

            {alreadyRegistered ? null : seminar.availability !== 'open' ? (
              <p className="border border-border p-5 text-sm text-muted-foreground">{AVAILABILITY_LABELS[seminar.availability]} — registration is not currently open for this seminar.</p>
            ) : isEntitledMember ? (
              <SeminarRegisterCta paymentMethods={paymentMethods} seminarId={seminar.id} />
            ) : isSignedIn ? (
              <p className="border border-border p-5 text-sm text-muted-foreground">An active IDOC membership is required to register. <Link className="underline underline-offset-4" href="/dashboard/membership">Renew or manage your membership</Link>.</p>
            ) : (
              <p className="border border-border p-5 text-sm text-muted-foreground">Only signed-in IDOC members can register. <Link className="underline underline-offset-4" href="/sign-in">Sign in</Link> or <Link className="underline underline-offset-4" href="/sign-up">join IDOC</Link> to register.</p>
            )}
          </div>

          <Card>
            <CardContent className="space-y-8 pt-0">
              {([
                ['Course Directors', seminar.course_directors],
                ['Participant Profile', seminar.participant_profile],
                ['Course Venue Information', seminar.course_venue_information],
                ['Application', seminar.application],
                ['Accommodation Information', seminar.accommodation_information],
              ] as const).filter(([, html]) => html).map(([heading, html]) => (
                <section key={heading}>
                  <h2 className="mb-3 text-lg font-bold uppercase tracking-wider text-gold">{heading}</h2>
                  <div className="idoc-rich-content idoc-rich-content--compact max-w-none text-foreground" dangerouslySetInnerHTML={{ __html: sanitizeArticleContent(html) }} />
                </section>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
