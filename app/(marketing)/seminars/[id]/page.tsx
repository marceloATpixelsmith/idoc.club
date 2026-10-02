import { Banknote, Calendar, CalendarClock, Languages, Layers, MapPin, Users, Flag } from 'lucide-react';
import type { Metadata } from 'next';
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
import { countryNameForCode } from '@/lib/membership/countries';
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
    title: `${seminar.title} — IDOC Seminars`,
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
  // Only a currently entitled member gets the pre-filled, member-price form directly. A signed-in
  // visitor who has their own profile but cannot use the member price (a lapsed membership) still
  // goes straight to the same form -- pre-filled and locked from their real profile, tied to their
  // real profileId -- just at the non-member price, so it correctly shows up in their own My
  // Seminars afterward instead of becoming an orphaned guest registration. Only a signed-in visitor
  // with no profile at all (e.g. a pure administrator) falls back to the guest form -- there's no
  // profile to tie a registration to either way -- but even then, "Create an account" would make no
  // sense to someone already logged in, so they skip straight to the form instead of that choice.
  const isEntitledMember = Boolean(member && isEntitled(member.entitlement, new Date().toISOString().slice(0, 10)));
  const isSignedIn = Boolean(user);
  const dateRange = seminar.start_date === seminar.end_date
    ? formatDate(seminar.start_date)
    : `${formatDate(seminar.start_date)} – ${formatDate(seminar.end_date)}`;
  const deadlineDate = formatDate(new Date(seminar.registration_deadline).toISOString().slice(0, 10));
  const levelsLabel = formatLevels(seminar.levels);

  return (
    <>
      <PageHeader eyebrow="Seminar" intro={`${formatSchedule(seminar)} · ${seminar.location}`} title={seminar.title} />
      <div className="mx-auto max-w-7xl px-5 pb-16 lg:px-8">
        <BackLink href="/seminars">Back to Seminars</BackLink>
        {flash === 'seminar-registration-success' ? (
          <FlashBanner targetPath={`/seminars/${id}`}>Registration completed successfully. Your seminar registration confirmation will be sent by email.</FlashBanner>
        ) : null}
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
                  <InfoRow icon={Flag}>Organizing National Federation: {countryNameForCode(seminar.organizing_national_federation)}</InfoRow>
                  <InfoRow icon={Users}>Number of participants: {seminar.capacity}</InfoRow>
                  <InfoRow icon={Banknote}>Members: {money(seminar.member_price_cents)} · Non-members: {money(seminar.non_member_price_cents)}</InfoRow>
                  {levelsLabel ? <InfoRow icon={Layers}>{levelsLabel}</InfoRow> : null}
                  <InfoRow icon={CalendarClock}>Registration deadline: {deadlineDate}</InfoRow>
                </div>
                {seminar.is_fei ? <div className="border-t border-border p-5"><FeiBadge className="h-6" /></div> : null}
              </CardContent>
            </Card>

            {alreadyRegistered ? null : seminar.availability !== 'open' ? (
              <p className="border border-border p-5 text-sm text-muted-foreground">{AVAILABILITY_LABELS[seminar.availability]} — registration is not currently open for this seminar.</p>
            ) : (
              <SeminarRegisterCta
                isSignedIn={isSignedIn}
                memberDetails={isEntitledMember && member ? { email: member.email, name: `${member.profile.firstName} ${member.profile.lastName}`.trim() } : undefined}
                memberPriceLabel={money(seminar.member_price_cents)}
                ownProfileDetails={!isEntitledMember && member ? { email: member.email, name: `${member.profile.firstName} ${member.profile.lastName}`.trim() } : undefined}
                paymentMethods={paymentMethods}
                seminarId={seminar.id}
              />
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
                  <h2 className="mb-3 text-lg font-bold uppercase tracking-wider text-orange">{heading}</h2>
                  <div className="prose prose-sm max-w-none text-foreground" dangerouslySetInnerHTML={{ __html: sanitizeArticleContent(html) }} />
                </section>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
