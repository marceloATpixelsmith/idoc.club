'use client';

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AdminReadOnlyTable } from '@/components/admin/admin-read-only-table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MEMBERSHIP_STATUS_LABELS } from '@/lib/membership/entitlement';
import type { getPrivateMember, listAdminPaymentHistory, listAuditHistory, listNotificationHistory } from '@/lib/membership/data-access';
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
type NotificationEntry = Awaited<ReturnType<typeof listNotificationHistory>>[number];
type StripePayment = { amount_cents: number; currency: string; id: number; paid_at: Date | string; refund_status: string | null; source: string };

const PAYMENT_SOURCE_LABELS: Record<string, string> = {
  bank_transfer: 'Bank transfer', cash: 'Cash', complimentary: 'Complimentary grant',
  paypal: 'PayPal', stripe_one_time: 'Stripe one-time', stripe_recurring: 'Stripe recurring',
};
const NOTIFICATION_KIND_LABELS: Record<string, string> = {
  'administrator.profile_changed': 'Profile changed (admin alert)',
  'membership.expiration_reminder': 'Expiration reminder',
  'membership.grace_expired': 'Grace period ended',
  'membership.grace_reminder': 'Grace period reminder',
  'membership.payment_failed': 'Payment failed / grace started',
  'membership.renewal_reminder': 'Renewal reminder',
  'stripe.customer_email_sync': 'Stripe email sync',
};

function money(amountCents: number, currency: string) {
  return new Intl.NumberFormat('en', { currency, style: 'currency' }).format(amountCents / 100);
}

function notificationOutcome(row: NotificationEntry): string {
  if (row.sentAt) return 'Delivered';
  if (row.deadLetteredAt) return 'Failed (gave up)';
  if (row.lastErrorCode) return 'Retrying';
  return 'Pending';
}

/** Every tab section is this same shape (a heading, optional explanation, then content) styled as a
 * rounded card, so cards -- not raw stacked fields -- are what flow into a responsive grid below. */
function Section({ children, description, title }: { children: ReactNode; description?: string; title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xs font-bold uppercase tracking-wider text-gold">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

const TABS = ['overview', 'edit', 'membership', 'payment', 'account', 'roles', 'notifications', 'audit'] as const;
type Tab = (typeof TABS)[number];

export function MemberDetailSheet({
  accountState,
  activeRoles,
  auditHistory,
  closeHref,
  initialTab,
  isSuperAdmin,
  notificationHistory,
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
  notificationHistory: NotificationEntry[];
  paymentHistory: PaymentHistoryEntry[];
  seminarHistory: SeminarHistoryEntry[];
  selected: Selected;
  stripePayments: StripePayment[];
}) {
  const router = useRouter();
  const requestedTab = (TABS as readonly string[]).includes(initialTab ?? '') ? (initialTab as Tab) : 'overview';
  const [tab, setTab] = useState<Tab>(requestedTab === 'roles' && !isSuperAdmin ? 'overview' : requestedTab);
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

        <Tabs onValueChange={(value) => setTab(value as Tab)} value={tab}>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="edit">Edit Info</TabsTrigger>
            <TabsTrigger value="membership">Membership</TabsTrigger>
            <TabsTrigger value="payment">Payment</TabsTrigger>
            <TabsTrigger value="account">Account</TabsTrigger>
            {isSuperAdmin && <TabsTrigger value="roles">Roles</TabsTrigger>}
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
            <TabsTrigger value="audit">Audit Trail</TabsTrigger>
          </TabsList>

          <TabsContent className="space-y-4" value="overview">
            <Section title="Seminar history">
              <div className="overflow-x-auto"><table className="min-w-full border text-sm"><thead><tr><th className="p-2 text-left">Seminar</th><th className="p-2 text-left">Date</th><th className="p-2 text-left">Registration</th><th className="p-2 text-left">Payment</th><th className="p-2 text-left">Seminar status</th><th className="p-2 text-left">Location</th></tr></thead><tbody>
                {seminarHistory.length === 0 ? <tr><td className="p-4 text-muted-foreground" colSpan={6}>No seminar history is associated with this member.</td></tr> : seminarHistory.map((seminar) => <tr className="border-t" key={seminar.id}><td className="p-2">{seminar.title}</td><td className="p-2">{seminar.seminarDate}</td><td className="p-2">{seminar.registrationStatus}</td><td className="p-2">{seminar.paymentStatus}</td><td className="p-2">{seminar.seminarStatus}</td><td className="p-2">{seminar.location}</td></tr>)}
              </tbody></table></div>
            </Section>
            <Section title="Payment history">
              <div className="overflow-x-auto"><table className="min-w-full border text-sm"><thead><tr><th className="p-2 text-left">Payment date</th><th className="p-2 text-left">Amount</th><th className="p-2 text-left">Source</th><th className="p-2 text-left">Origin</th><th className="p-2 text-left">Reference</th></tr></thead><tbody>
                {paymentHistory.length === 0 ? <tr><td className="p-4 text-muted-foreground" colSpan={5}>No payments have been recorded for this member.</td></tr> : paymentHistory.map((payment, index) => <tr className="border-t" key={`${payment.paidAt.toISOString()}-${index}`}><td className="p-2">{payment.paidAt.toISOString()}</td><td className="p-2">{money(payment.amountCents, payment.currency)}</td><td className="p-2">{PAYMENT_SOURCE_LABELS[payment.source] ?? payment.source}</td><td className="p-2">{payment.source.startsWith('stripe_') ? 'Stripe' : 'Manual'}</td><td className="p-2">{payment.reference ?? '—'}</td></tr>)}
              </tbody></table></div>
            </Section>
          </TabsContent>

          <TabsContent value="edit">
            <p className="mb-4 text-sm text-muted-foreground">Membership type changes preserve role history and do not change expiration, payments, or Stripe billing.</p>
            <AdminProfileForm member={selected} profileId={profile.id} />
          </TabsContent>

          <TabsContent value="membership">
            <div className="grid gap-4 md:grid-cols-2">
              {selected.entitlement && (
                <Section description="Extension only: this does not add a payment or change Stripe billing dates. Use Correct entitlement for a genuine correction." title="Extend expiration date">
                  <ExtendExpirationForm currentValidUntil={selected.entitlement.validUntil} profileId={profile.id} />
                </Section>
              )}
              <Section title="Correct entitlement">
                <EntitlementCorrectionForm currentValidUntil={selected.entitlement?.validUntil ?? null} profileId={profile.id} />
              </Section>
              <Section title="Membership status">
                {selected.entitlement?.status === 'suspended'
                  ? <ReinstateForm profileId={profile.id} />
                  : selected.entitlement
                    ? <SuspendForm profileId={profile.id} />
                    : <p className="text-sm text-muted-foreground">No membership on file — nothing to suspend.</p>}
              </Section>
            </div>
          </TabsContent>

          <TabsContent value="payment">
            <div className="grid gap-4 md:grid-cols-2">
              <Section title="Record a manual payment">
                <ManualPaymentForm currentValidUntil={selected.entitlement?.validUntil ?? null} profileId={profile.id} />
              </Section>
              <Section title="Stripe payment history">
                {stripePayments.length === 0 ? <p className="text-sm">No refundable Stripe payments.</p> : <div className="space-y-3">{stripePayments.map((payment) => <article className="border-t pt-3 first:border-t-0 first:pt-0" key={payment.id}>
                  <p className="text-sm">{payment.source} · {new Intl.NumberFormat('en-IE', { currency: payment.currency, style: 'currency' }).format(payment.amount_cents / 100)} · {new Date(payment.paid_at).toLocaleDateString()}</p>
                  {payment.refund_status === 'succeeded' ? <p className="text-sm font-medium">Refunded</p> : <MembershipRefundForm paymentId={String(payment.id)} profileId={String(profile.id)} />}
                </article>)}</div>}
              </Section>
            </div>
          </TabsContent>

          <TabsContent value="account">
            <Section description="Distinct from membership status: this controls whether the user can sign in at all." title="Account authentication">
              {accountState === 'suspended'
                ? <ReinstateAccountForm userId={profile.userId} />
                : <SuspendAccountForm userId={profile.userId} />}
            </Section>
          </TabsContent>

          {isSuperAdmin && (
            <TabsContent value="roles">
              <div className="grid gap-4 md:grid-cols-2">
                <Section title="Application roles">
                  <RolesSection activeRoles={activeRoles} userId={profile.userId} />
                </Section>
                <Section title="Incident response">
                  <ForceRevokeAllAuthorityForm userId={profile.userId} />
                </Section>
              </div>
            </TabsContent>
          )}

          <TabsContent value="notifications">
            <Section title="Notification delivery history">
              <AdminReadOnlyTable
                columns={[{ id: 'kind', label: 'Kind' }, { id: 'created', label: 'Created' }, { id: 'sent', label: 'Sent' }, { id: 'attempts', label: 'Attempts' }, { id: 'lastError', label: 'Last error' }, { id: 'status', label: 'Status' }]}
                empty="No notifications on file for this member."
                rows={notificationHistory.map((row) => ({
                  id: String(row.id), kind: NOTIFICATION_KIND_LABELS[row.kind] ?? row.kind,
                  created: row.createdAt.toISOString(), sent: row.sentAt ? row.sentAt.toISOString() : '—',
                  attempts: String(row.attemptCount), lastError: row.lastErrorCode ?? '—', status: notificationOutcome(row),
                }))}
                searchLabel="Search notification history"
                statusColumn="status"
                tableType="notifications"
              />
            </Section>
          </TabsContent>

          <TabsContent value="audit">
            <Section title="Audit trail">
              <table className="min-w-full border text-sm">
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
            </Section>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
