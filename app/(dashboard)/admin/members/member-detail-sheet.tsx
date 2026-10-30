'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useCallback, useState, useTransition } from 'react';
import { useAdminDrawerClose } from '@/components/admin/admin-form-drawer';
import { AdminReadOnlyTable, type ReadOnlyRow } from '@/components/admin/admin-read-only-table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { MemberPaymentsTable } from '../payments/member-payments-table';
import { formatTableDate } from '@/lib/format';
import type { TablePreferenceState } from '@/lib/admin/table-preferences';

type Selected = NonNullable<Awaited<ReturnType<typeof getPrivateMember>>>;
type ActiveRole = Awaited<ReturnType<typeof listActiveRoles>>[number];
type PaymentHistoryEntry = Awaited<ReturnType<typeof listAdminPaymentHistory>>[number];
type SeminarHistoryEntry = Awaited<ReturnType<typeof listAdminSeminarHistoryForMember>>[number];
type AuditEntry = Awaited<ReturnType<typeof listAuditHistory>>[number];
type StripePayment = { amount_cents: number; currency: string; id: number; paid_at: Date | string; refund_status: string | null; source: string };

const PAYMENT_SOURCE_LABELS: Record<string, string> = {
  bank_transfer: 'Bank transfer', cash: 'Cash', complimentary: 'Complimentary grant',
  stripe_manual: 'Stripe (manual)', stripe_one_time: 'Stripe one-time', stripe_recurring: 'Stripe recurring',
};

function money(amountCents: number, currency: string) {
  return new Intl.NumberFormat('en', { currency, style: 'currency' }).format(amountCents / 100);
}

/** Every tab section is this same shape (a heading, optional explanation, then content) styled as a
 * rounded card, so cards -- not raw stacked fields -- are what flow into a responsive grid below. */
function Section({ children, description, title }: { children: ReactNode; description?: string; title: string }) {
  return (
    <Card className="min-w-0">
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
  notificationPreferences,
  paymentHistory,
  paymentPreferences,
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
  notificationHistory: ReadOnlyRow[];
  notificationPreferences?: TablePreferenceState | null;
  paymentHistory: PaymentHistoryEntry[];
  paymentPreferences?: TablePreferenceState | null;
  seminarHistory: SeminarHistoryEntry[];
  selected: Selected;
  stripePayments: StripePayment[];
}) {
  const requestedTab = (TABS as readonly string[]).includes(initialTab ?? '') ? (initialTab as Tab) : 'overview';
  const [tab, setTab] = useState<Tab>(requestedTab === 'roles' && !isSuperAdmin ? 'overview' : requestedTab);
  const { profile } = selected;
  const router = useRouter();
  const [paymentsRefreshing, startPaymentRefresh] = useTransition();
  const refreshPayments = useCallback(() => {
    startPaymentRefresh(() => router.refresh());
  }, [router]);
  // `open` was previously hardcoded to the literal `true` rather than real state, which made this a
  // Radix "controlled" component whose value never actually changed -- so closing (X, overlay click,
  // Escape) never played the exit animation at all; the Sheet just sat there, fully open, until the
  // slower background navigation eventually unmounted it outright. Backing `open` with real state
  // lets Radix's own close animation start immediately, independent of how long closeHref's
  // navigation takes underneath.
  const { closeAndRefresh, onOpenChange, open } = useAdminDrawerClose(closeHref);

  // Sheet content is fetched server-side keyed off the profileId URL param (the same sanctioned
  // exception used elsewhere -- see app/(dashboard)/admin/members/page.tsx); closing just navigates
  // back to the bare members URL rather than tracking a separate open/closed flag beyond `open` itself.
  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent className="w-full overflow-y-auto sm:w-[70vw] sm:max-w-4xl">
        <SheetHeader>
          <SheetTitle className="text-3xl font-semibold text-gold">Member</SheetTitle>
          <SheetDescription>
            {selected.entitlement ? (MEMBERSHIP_STATUS_LABELS[selected.entitlement.status] ?? selected.entitlement.status) : 'No membership on file'}
            {selected.entitlement && ` · Paid through ${selected.entitlement.validUntil}`}
            {' · '}<a className="underline underline-offset-4" href={`mailto:${encodeURIComponent(selected.email)}`}>{selected.email}</a>
          </SheetDescription>
        </SheetHeader>

        <Tabs className="mt-2" onValueChange={(value) => setTab(value as Tab)} value={tab}>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="edit">Edit Info</TabsTrigger>
            <TabsTrigger value="membership">Membership</TabsTrigger>
            <TabsTrigger value="payment">Payment</TabsTrigger>
            <TabsTrigger value="account">Security</TabsTrigger>
            {isSuperAdmin && <TabsTrigger value="roles">Roles</TabsTrigger>}
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
            <TabsTrigger value="audit">Audit Trail</TabsTrigger>
          </TabsList>

          <TabsContent className="space-y-4" value="overview">
            <Section title="Seminar history">
              <div className="overflow-x-auto"><table className="min-w-full border text-sm"><thead><tr><th className="p-2 text-left">Seminar</th><th className="p-2 text-left">Date</th><th className="p-2 text-left">Registration</th><th className="p-2 text-left">Payment</th><th className="p-2 text-left">Seminar status</th><th className="p-2 text-left">Location</th></tr></thead><tbody>
                {seminarHistory.length === 0 ? <tr><td className="p-4 text-muted-foreground" colSpan={6}>No seminar history is associated with this member.</td></tr> : seminarHistory.map((seminar) => <tr className="border-t" key={seminar.id}><td className="p-2">{seminar.title}</td><td className="p-2">{formatTableDate(seminar.seminarDate)}</td><td className="p-2">{seminar.registrationStatus}</td><td className="p-2">{seminar.paymentStatus}</td><td className="p-2">{seminar.seminarStatus}</td><td className="p-2">{seminar.location}</td></tr>)}
              </tbody></table></div>
            </Section>
            <Section title="Payment history">
              <div className="overflow-x-auto"><table className="min-w-full border text-sm"><thead><tr><th className="p-2 text-left">Payment date</th><th className="p-2 text-left">Amount</th><th className="p-2 text-left">Source</th><th className="p-2 text-left">Origin</th><th className="p-2 text-left">Reference</th></tr></thead><tbody>
                {paymentHistory.length === 0 ? <tr><td className="p-4 text-muted-foreground" colSpan={5}>No payments have been recorded for this member.</td></tr> : paymentHistory.map((payment, index) => <tr className="border-t" key={`${payment.paidAt.toISOString()}-${index}`}><td className="p-2">{formatTableDate(payment.paidAt)}</td><td className="p-2">{money(payment.amountCents, payment.currency)}</td><td className="p-2">{PAYMENT_SOURCE_LABELS[payment.source] ?? payment.source}</td><td className="p-2">{payment.source.startsWith('stripe_') ? 'Stripe' : 'Manual'}</td><td className="p-2">{payment.reference ?? '—'}</td></tr>)}
              </tbody></table></div>
            </Section>
          </TabsContent>

          <TabsContent value="edit">
            <p className="mb-4 text-sm text-muted-foreground">Membership type changes preserve role history and do not change expiration, payments, or Stripe billing.</p>
            <AdminProfileForm member={selected} onSuccess={closeAndRefresh} profileId={profile.id} />
          </TabsContent>

          <TabsContent value="membership">
            <div className="grid gap-4 md:grid-cols-2">
              {selected.entitlement && (
                <Section description="Extension only: this does not add a payment or change Stripe billing dates. Use Correct entitlement for a genuine correction." title="Extend expiration date">
                  <ExtendExpirationForm currentValidUntil={selected.entitlement.validUntil} onSuccess={closeAndRefresh} profileId={profile.id} />
                </Section>
              )}
              <Section title="Correct entitlement">
                <EntitlementCorrectionForm currentValidUntil={selected.entitlement?.validUntil ?? null} onSuccess={closeAndRefresh} profileId={profile.id} />
              </Section>
              <Section title="Membership status">
                {selected.entitlement?.status === 'suspended' || selected.entitlement?.status === 'canceled'
                  ? <ReinstateForm onSuccess={closeAndRefresh} profileId={profile.id} />
                  : selected.entitlement
                    ? <SuspendForm onSuccess={closeAndRefresh} profileId={profile.id} />
                    : <p className="text-sm text-muted-foreground">No membership on file — nothing to cancel.</p>}
              </Section>
            </div>
          </TabsContent>

          <TabsContent value="payment">
            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <Section title="Record a manual payment">
                <ManualPaymentForm currentValidUntil={selected.entitlement?.validUntil ?? null} onSuccess={refreshPayments} profileId={profile.id} />
              </Section>

              <Section title="Payment history">
                <MemberPaymentsTable initialPreferences={paymentPreferences} loading={paymentsRefreshing} onSuccess={closeAndRefresh} payments={stripePayments} profileId={String(profile.id)} />
              </Section>
            </div>
          </TabsContent>

          <TabsContent value="account">
            <Section description="Distinct from membership status: this controls whether the user can sign in at all." title="Account authentication">
              {accountState === 'suspended'
                ? <ReinstateAccountForm onSuccess={closeAndRefresh} userId={profile.userId} />
                : <SuspendAccountForm onSuccess={closeAndRefresh} userId={profile.userId} />}
            </Section>
          </TabsContent>

          {isSuperAdmin && (
            <TabsContent value="roles">
              <div className="grid gap-4 md:grid-cols-2">
                <Section title="Application roles">
                  <RolesSection activeRoles={activeRoles} onSuccess={closeAndRefresh} userId={profile.userId} />
                </Section>
                <Section title="Incident response">
                  <ForceRevokeAllAuthorityForm onSuccess={closeAndRefresh} userId={profile.userId} />
                </Section>
              </div>
            </TabsContent>
          )}

          <TabsContent value="notifications">
            <Section title="Notification delivery history">
              <AdminReadOnlyTable
                columns={[{ id: 'kind', label: 'Kind' }, { id: 'created', label: 'Created' }, { id: 'sent', label: 'Sent' }, { id: 'attempts', label: 'Attempts' }, { id: 'lastError', label: 'Last error' }, { id: 'status', label: 'Status' }]}
                empty="No notifications on file for this member."
                initialPreferences={notificationPreferences}
                preferenceKey="member_notifications"
                rows={notificationHistory}
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
                      <td className="p-2">{formatTableDate(entry.createdAt)}</td>
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
