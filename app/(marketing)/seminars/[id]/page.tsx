import { Calendar, Clock, MapPin } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FeiBadge } from '@/components/seminars/fei-badge';
import { PageHeader } from '@/components/site/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SeminarRegistrationForm } from '@/components/seminars/seminar-registration-form';
import { SeminarRegistrationPanel } from '@/components/seminars/seminar-registration-panel';
import { getUser } from '@/lib/db/queries';
import { getOwnPrivateMember } from '@/lib/membership/data-access';
import { isEntitled } from '@/lib/membership/entitlement';
import { formatDate, formatSchedule, formatTime, money } from '@/lib/seminars/format';
import { getSeminarForRegistrant, listEnabledSeminarPaymentMethods } from '@/lib/seminars/registrations';
import { AVAILABILITY_LABELS, registrationDisplayLabel, type PaymentStatus, type RegistrationStatus } from '@/lib/seminars/status';

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
  const timeRange = `${formatTime(seminar.start_time)} – ${formatTime(seminar.end_time)}`;

  return (
    <>
      <PageHeader eyebrow="Seminar" intro={`${formatSchedule(seminar)} · ${seminar.location}`} title={seminar.title} />
      <div className="mx-auto max-w-4xl px-5 pb-16 lg:px-8">
        <Link className="text-sm text-muted-foreground underline underline-offset-4" href="/seminars">← Back to Seminars</Link>

        {/* Details + Register come first in the markup -- and so first on mobile and on the left on
          * desktop -- since that's what a visitor actually came here to do. The long description
          * reads second, as supporting material rather than a wall of text blocking the CTA. */}
        <div className="mt-8 grid gap-6 lg:grid-cols-[2fr_3fr]">
          <div className="space-y-6">
            <Card>
              <CardContent className="space-y-0 p-0">
                <div className="divide-y divide-border">
                  <div className="flex items-start gap-4 p-5">
                    <Calendar aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
                    <div><p className="text-[0.68rem] uppercase tracking-[0.18em] text-gold">Date</p><p className="mt-1 text-base">{dateRange}</p></div>
                  </div>
                  <div className="flex items-start gap-4 p-5">
                    <Clock aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
                    <div><p className="text-[0.68rem] uppercase tracking-[0.18em] text-gold">Time</p><p className="mt-1 text-base">{timeRange}</p></div>
                  </div>
                  <div className="flex items-start gap-4 p-5">
                    <MapPin aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
                    <div><p className="text-[0.68rem] uppercase tracking-[0.18em] text-gold">Location</p><p className="mt-1 text-base">{seminar.location}</p></div>
                  </div>
                </div>
                {seminar.is_fei ? <div className="border-t border-border p-5"><FeiBadge className="h-6" /></div> : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-xs font-bold uppercase tracking-wider text-gold">Register</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1 text-sm">
                  <p><span className="text-muted-foreground">Member price:</span> <span className="font-medium">{money(seminar.member_price_cents)}</span></p>
                  <p><span className="text-muted-foreground">Non-member price:</span> <span className="font-medium">{money(seminar.non_member_price_cents)}</span></p>
                  <p><span className="text-muted-foreground">Availability:</span> {AVAILABILITY_LABELS[seminar.availability]}</p>
                </div>
                {alreadyRegistered ? (
                  <div className="space-y-2 text-sm">
                    <p>Your registration: <strong>{registrationDisplayLabel(seminar.registration_status as RegistrationStatus, (seminar.payment_status ?? 'unpaid') as PaymentStatus)}</strong></p>
                    <Link className="underline underline-offset-4" href="/seminars?view=my">Manage in My Seminars</Link>
                  </div>
                ) : seminar.availability !== 'open' ? (
                  <p className="text-sm text-muted-foreground">{AVAILABILITY_LABELS[seminar.availability]} — registration is not currently open for this seminar.</p>
                ) : isEntitledMember && member ? (
                  <SeminarRegistrationForm
                    memberDetails={{ email: member.email, name: `${member.profile.firstName} ${member.profile.lastName}`.trim() }}
                    paymentMethods={paymentMethods}
                    seminarId={seminar.id}
                  />
                ) : member ? (
                  <SeminarRegistrationForm
                    ownProfileDetails={{ email: member.email, name: `${member.profile.firstName} ${member.profile.lastName}`.trim() }}
                    paymentMethods={paymentMethods}
                    seminarId={seminar.id}
                  />
                ) : isSignedIn ? (
                  <SeminarRegistrationForm paymentMethods={paymentMethods} seminarId={seminar.id} />
                ) : (
                  <SeminarRegistrationPanel paymentMethods={paymentMethods} seminarId={seminar.id} />
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-xs font-bold uppercase tracking-wider text-gold">Directors and Application Details</CardTitle></CardHeader>
            <CardContent><p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{seminar.description}</p></CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
