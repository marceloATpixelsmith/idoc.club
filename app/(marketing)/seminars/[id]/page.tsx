import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/site/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SeminarRegistrationForm } from '@/components/seminars/seminar-registration-form';
import { SeminarRegistrationPanel } from '@/components/seminars/seminar-registration-panel';
import { getOwnPrivateMember } from '@/lib/membership/data-access';
import { isEntitled } from '@/lib/membership/entitlement';
import { formatSchedule, money } from '@/lib/seminars/format';
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
  const member = await ownMember();
  const seminar = await getSeminarForRegistrant(id, member?.profile.id ?? null);
  if (!seminar) notFound();

  const paymentMethods = await listEnabledSeminarPaymentMethods();
  const alreadyRegistered = seminar.registration_status !== null;
  // Only a currently entitled member gets the pre-filled, member-price form directly -- anyone else
  // (signed out, no profile, or a lapsed membership) sees the same join-or-guest choice a
  // never-registered visitor does, since they cannot actually complete the member-priced path.
  const isEntitledMember = Boolean(member && isEntitled(member.entitlement, new Date().toISOString().slice(0, 10)));

  return (
    <>
      <PageHeader eyebrow="Seminar" intro={`${formatSchedule(seminar)} · ${seminar.location}`} title={seminar.title} />
      <div className="mx-auto max-w-4xl px-5 pb-16 lg:px-8">
        <Link className="text-sm text-muted-foreground underline underline-offset-4" href="/seminars">← Back to Seminars</Link>

        <div className="mt-8 grid gap-6 lg:grid-cols-[3fr_2fr]">
          <Card>
            <CardHeader><CardTitle className="text-xs font-bold uppercase tracking-wider text-gold">Directors and Application Details</CardTitle></CardHeader>
            <CardContent><p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{seminar.description}</p></CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader><CardTitle className="text-xs font-bold uppercase tracking-wider text-gold">Details</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p><span className="text-muted-foreground">When:</span> {formatSchedule(seminar)}</p>
                <p><span className="text-muted-foreground">Where:</span> {seminar.location}</p>
                <p><span className="text-muted-foreground">Member price:</span> {money(seminar.member_price_cents)}</p>
                <p><span className="text-muted-foreground">Non-member price:</span> {money(seminar.non_member_price_cents)}</p>
                <p><span className="text-muted-foreground">Availability:</span> {AVAILABILITY_LABELS[seminar.availability]}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-xs font-bold uppercase tracking-wider text-gold">Register</CardTitle></CardHeader>
              <CardContent>
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
                ) : (
                  <SeminarRegistrationPanel paymentMethods={paymentMethods} seminarId={seminar.id} />
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
