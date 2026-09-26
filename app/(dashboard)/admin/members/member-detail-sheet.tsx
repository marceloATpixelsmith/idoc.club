'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MEMBERSHIP_STATUS_LABELS } from '@/lib/membership/entitlement';
import type { getPrivateMember, listAdminPaymentHistory, listAuditHistory } from '@/lib/membership/data-access';
import type { listActiveRoles } from '@/lib/membership/role-grants';
import type { listAdminSeminarHistoryForMember } from '@/lib/seminars/registrations';
import { AdminProfileForm } from './admin-profile-form';
import { EntitlementCorrectionForm } from './entitlement-correction-form';
import { ReinstateForm, SuspendForm } from './membership-status-form';
import { ForceRevokeAllAuthorityForm, ReinstateAccountForm, SuspendAccountForm } from './account-suspension-form';
import { RolesSection } from './roles-section';
import { ExtendExpirationForm } from './extend-expiration-form';
import { ManualPaymentForm } from '../payments/manual-payment-form';
import { MembershipRefundForm } from '../payments/refund-form';

type Selected = NonNullable<Awaited<ReturnType<typeof getPrivateMember>>>;
type ActiveRole = Awaited<ReturnType<typeof listActiveRoles>>[number];
type PaymentHistoryEntry = Awaited<ReturnType<typeof listAdminPaymentHistory>>[number];
type SeminarHistoryEntry = Awaited<ReturnType<typeof listAdminSeminarHistoryForMember>>[number];
type AuditEntry = Awaited<ReturnType<typeof listAuditHistory>>[number];
type StripePayment = { amount_cents: number; currency: string; id: number; paid_at: Date | string; refund_status: string | null; source: string };

const PAYMENT_SOURCE_LABELS: Record<string, string> = {
  bank_transfer: 'Bank transfer', cash: 'Cash', complimentary: 'Complimentary grant',
  paypal: 'PayPal', stripe_one_time: 'Stripe one-time', stripe_recurring: 'Stripe recurring',
};

function money(amountCents: number, currency: string) {
  return new Intl.NumberFormat('en', { currency, style: 'currency' }).format(amountCents / 100);
}

const TABS = ['overview', 'edit', 'membership', 'payment', 'account', 'roles', 'audit'] as const;
type Tab = (typeof TABS)[number];

export function MemberDetailSheet({
  accountState,
  activeRoles,
  auditHistory,
  closeHref,
  initialTab,
  isSuperAdmin,
  paymentHistory,
  seminarHistory,
  selected,
  stripePayments,
}: {
  accountState: string | null;
  activeRoles: ActiveRole[];
  auditHistory: AuditEntry[];
  closeHref: string;
  initialTab?: string;
  isSuperAdmin: boolean;
  paymentHistory: PaymentHistoryEntry[];
  seminarHistory: SeminarHistoryEntry[];
  selected: Selected;
  stripePayments: StripePayment[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>((TABS as readonly string[]).includes(initialTab ?? '') ? (initialTab as Tab) : 'overview');
  const { profile } = selected;

  // Sheet content is fetched server-side keyed off the profileId URL param (the same sanctioned
  // exception used elsewhere -- see app/(dashboard)/admin/members/page.tsx); closing just navigates
  // back to the bare members URL rather than tracking a separate open/closed flag.
  return (
    <Sheet onOpenChange={(open) => { if (!open) router.push(closeHref); }} open>
      <SheetContent className="w-full overflow-y-auto sm:w-[70vw] sm:max-w-4xl">
        <SheetHeader>
          <SheetTitle>{profile.firstName} {profile.lastName}</SheetTitle>
          <SheetDescription>
            {selected.entitlement ? (MEMBERSHIP_STATUS_LABELS[selected.entitlement.status] ?? selected.entitlement.status) : 'No membership on file'}
            {selected.entitlement && ` · Paid through ${selected.entitlement.validUntil}`}
            {' · '}<a className="underline underline-offset-4" href={`mailto:${encodeURIComponent(selected.email)}`}>{selected.email}</a>
          </SheetDescription>
        </SheetHeader>

        <Tabs className="mt-4 min-h-0 flex-1" onValueChange={(value) => setTab(value as Tab)} value={tab}>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="edit">Edit Info</TabsTrigger>
            <TabsTrigger value="membership">Membership</TabsTrigger>
            <TabsTrigger value="payment">Payment</TabsTrigger>
            <TabsTrigger value="account">Account</TabsTrigger>
            {isSuperAdmin && <TabsTrigger value="roles">Roles</TabsTrigger>}
            <TabsTrigger value="audit">Audit Trail</TabsTrigger>
          </TabsList>

          <TabsContent className="space-y-8" value="overview">
            <section>
              <h3 className="font-bold uppercase tracking-wider text-gold">Seminar history</h3>
              <div className="mt-2 overflow-x-auto"><table className="min-w-full border text-sm"><thead><tr><th className="p-2 text-left">Seminar</th><th className="p-2 text-left">Date</th><th className="p-2 text-left">Registration</th><th className="p-2 text-left">Payment</th><th className="p-2 text-left">Seminar status</th><th className="p-2 text-left">Location</th></tr></thead><tbody>
                {seminarHistory.length === 0 ? <tr><td className="p-4 text-muted-foreground" colSpan={6}>No seminar history is associated with this member.</td></tr> : seminarHistory.map((seminar) => <tr className="border-t" key={seminar.id}><td className="p-2">{seminar.title}</td><td className="p-2">{seminar.seminarDate}</td><td className="p-2">{seminar.registrationStatus}</td><td className="p-2">{seminar.paymentStatus}</td><td className="p-2">{seminar.seminarStatus}</td><td className="p-2">{seminar.location}</td></tr>)}
              </tbody></table></div>
            </section>
            <section>
              <h3 className="font-bold uppercase tracking-wider text-gold">Payment history</h3>
              <div className="mt-2 overflow-x-auto"><table className="min-w-full border text-sm"><thead><tr><th className="p-2 text-left">Payment date</th><th className="p-2 text-left">Amount</th><th className="p-2 text-left">Source</th><th className="p-2 text-left">Origin</th><th className="p-2 text-left">Reference</th></tr></thead><tbody>
                {paymentHistory.length === 0 ? <tr><td className="p-4 text-muted-foreground" colSpan={5}>No payments have been recorded for this member.</td></tr> : paymentHistory.map((payment, index) => <tr className="border-t" key={`${payment.paidAt.toISOString()}-${index}`}><td className="p-2">{payment.paidAt.toISOString()}</td><td className="p-2">{money(payment.amountCents, payment.currency)}</td><td className="p-2">{PAYMENT_SOURCE_LABELS[payment.source] ?? payment.source}</td><td className="p-2">{payment.source.startsWith('stripe_') ? 'Stripe' : 'Manual'}</td><td className="p-2">{payment.reference ?? '—'}</td></tr>)}
              </tbody></table></div>
            </section>
          </TabsContent>

          <TabsContent value="edit">
            <p className="mb-4 text-sm text-muted-foreground">Membership type changes preserve role history and do not change expiration, payments, or Stripe billing.</p>
            <AdminProfileForm member={selected} profileId={profile.id} />
          </TabsContent>

          <TabsContent className="space-y-8" value="membership">
            {selected.entitlement && (
              <section>
                <h3 className="font-bold uppercase tracking-wider text-gold">Extend expiration date</h3>
                <p className="mt-1 text-sm text-muted-foreground">Extension only: this does not add a payment or change Stripe billing dates. Use Correct entitlement below for a genuine correction.</p>
                <ExtendExpirationForm currentValidUntil={selected.entitlement.validUntil} profileId={profile.id} />
              </section>
            )}
            <section>
              <h3 className="font-bold uppercase tracking-wider text-gold">Correct entitlement</h3>
              <EntitlementCorrectionForm currentValidUntil={selected.entitlement?.validUntil ?? null} profileId={profile.id} />
            </section>
            <section>
              <h3 className="font-bold uppercase tracking-wider text-gold">Membership status</h3>
              {selected.entitlement?.status === 'suspended'
                ? <ReinstateForm profileId={profile.id} />
                : selected.entitlement
                  ? <SuspendForm profileId={profile.id} />
                  : <p className="mt-2 text-sm text-muted-foreground">No membership on file — nothing to suspend.</p>}
            </section>
          </TabsContent>

          <TabsContent className="space-y-8" value="payment">
            <section>
              <h3 className="font-bold uppercase tracking-wider text-gold">Record a manual payment</h3>
              <ManualPaymentForm currentValidUntil={selected.entitlement?.validUntil ?? null} profileId={profile.id} />
            </section>
            <section>
              <h3 className="font-bold uppercase tracking-wider text-gold">Stripe payment history</h3>
              {stripePayments.length === 0 ? <p className="mt-2 text-sm">No refundable Stripe payments.</p> : stripePayments.map((payment) => <article className="mt-3 border-t pt-3" key={payment.id}>
                <p className="text-sm">{payment.source} · {new Intl.NumberFormat('en-IE', { currency: payment.currency, style: 'currency' }).format(payment.amount_cents / 100)} · {new Date(payment.paid_at).toLocaleDateString()}</p>
                {payment.refund_status === 'succeeded' ? <p className="text-sm font-medium">Refunded</p> : <MembershipRefundForm paymentId={String(payment.id)} profileId={String(profile.id)} />}
              </article>)}
            </section>
          </TabsContent>

          <TabsContent value="account">
            <section>
              <h3 className="font-bold uppercase tracking-wider text-gold">Account authentication</h3>
              <p className="mt-1 text-sm text-muted-foreground">Distinct from membership status above: this controls whether the user can sign in at all.</p>
              {accountState === 'suspended'
                ? <ReinstateAccountForm userId={profile.userId} />
                : <SuspendAccountForm userId={profile.userId} />}
            </section>
          </TabsContent>

          {isSuperAdmin && (
            <TabsContent className="space-y-8" value="roles">
              <section>
                <h3 className="font-bold uppercase tracking-wider text-gold">Application roles</h3>
                <RolesSection activeRoles={activeRoles} userId={profile.userId} />
              </section>
              <section>
                <h3 className="font-bold uppercase tracking-wider text-gold">Incident response</h3>
                <ForceRevokeAllAuthorityForm userId={profile.userId} />
              </section>
            </TabsContent>
          )}

          <TabsContent value="audit">
            <table className="mt-2 min-w-full border text-sm">
              <thead>
                <tr className="border-b bg-surface text-left">
                  <th className="p-2">Action</th>
                  <th className="p-2">When</th>
                  <th className="p-2">Reason</th>
                  <th className="p-2">Detail</th>
                </tr>
              </thead>
              <tbody>
                {auditHistory.length === 0 && (
                  <tr><td className="p-2 text-muted-foreground" colSpan={4}>No audit entries for this member.</td></tr>
                )}
                {auditHistory.map((entry) => (
                  <tr key={entry.id} className="border-b align-top">
                    <td className="p-2">{entry.action}</td>
                    <td className="p-2">{entry.createdAt.toISOString()}</td>
                    <td className="p-2">{entry.reason ?? '—'}</td>
                    <td className="p-2">
                      <details>
                        <summary className="cursor-pointer underline">View</summary>
                        <pre className="mt-1 max-w-md overflow-x-auto text-xs">{JSON.stringify({ after: entry.afterJson, before: entry.beforeJson }, null, 2)}</pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
