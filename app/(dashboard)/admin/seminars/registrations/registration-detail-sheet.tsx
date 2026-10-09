'use client';

import { AdminFormDrawer } from '@/components/admin/admin-form-drawer';
import { AdminFormSection } from '@/components/admin/admin-form-section';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SeminarForm } from '@/components/seminars/seminar-form';
import { SeminarRefundForm } from '@/components/seminars/refund-form';
import { PaymentMethodSelect } from '@/components/seminars/payment-method-select';
import type { AdminSeminarRegistrationRow } from '@/lib/seminars/registrations';
import { PAYMENT_STATUS_LABELS, REGISTRATION_STATUSES } from '@/lib/seminars/status';
import { recordManualSeminarPaymentAction, setAdminRegistrationStatusAction, updateSeminarRegistrationDetailsAction } from '../actions';

const SELECT_CLASSNAME = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30';
const REGISTRATION_STATUS_LABELS: Record<string, string> = { canceled: 'Canceled', registered: 'Registered' };
const MANUAL_PAYMENT_METHODS = [{ label: 'Bank Transfer', value: 'bank_transfer' }, { label: 'Cash at the Event', value: 'cash_event' }] as const;
const MARKABLE_PAID_STATUSES = ['unpaid', 'pending', 'bank_transfer_pending', 'cash_pending', 'refund_failed'];

function money(amountCents: number | null, currency: string) {
  if (amountCents === null) return '—';
  return new Intl.NumberFormat('en', { currency, style: 'currency' }).format(amountCents / 100);
}

export function RegistrationDetailSheet({ closeHref, paymentMethods, registration }: {
  closeHref: string; paymentMethods: Array<{ canonical_id: unknown; display_label: unknown }>; registration: AdminSeminarRegistrationRow;
}) {
  const isGuest = registration.profile_id === null;
  return (
    <AdminFormDrawer closeHref={closeHref} title="Registration">
      <div className="space-y-4 px-5 py-6 lg:px-8">
        <p className="text-sm text-muted-foreground">{registration.seminar_title} · {isGuest ? 'Guest' : 'Member'}</p>
          <AdminFormSection title="Registrant details">
            <SeminarForm action={updateSeminarRegistrationDetailsAction} submitLabel="Save details">
              <input name="registrationId" type="hidden" value={registration.id} />
              {isGuest ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5"><Label htmlFor="guestFirstName">First name</Label><Input defaultValue={registration.guest_first_name ?? ''} id="guestFirstName" maxLength={100} name="guestFirstName" /></div>
                  <div className="space-y-1.5"><Label htmlFor="guestLastName">Last name</Label><Input defaultValue={registration.guest_last_name ?? ''} id="guestLastName" maxLength={100} name="guestLastName" /></div>
                  <div className="space-y-1.5"><Label htmlFor="guestEmail">Email</Label><Input defaultValue={registration.guest_email ?? ''} id="guestEmail" maxLength={255} name="guestEmail" required type="email" /></div>
                  <div className="space-y-1.5"><Label htmlFor="guestPhone">Phone</Label><Input defaultValue={registration.guest_phone ?? ''} id="guestPhone" maxLength={40} name="guestPhone" type="tel" /></div>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5"><Label>Name</Label><p className="text-sm">{registration.member_name}</p></div>
                  <div className="space-y-1.5"><Label>Email</Label><p className="text-sm">{registration.member_email}</p></div>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="paymentMethod">Payment method</Label>
                <PaymentMethodSelect
                  className={SELECT_CLASSNAME}
                  defaultValue={registration.payment_method_canonical_id}
                  id="paymentMethod"
                  name="paymentMethod"
                  options={paymentMethods.map((method) => ({ label: String(method.display_label), value: String(method.canonical_id) }))}
                />
              </div>
            </SeminarForm>
          </AdminFormSection>

          <AdminFormSection title="Registration status">
            <SeminarForm action={setAdminRegistrationStatusAction} submitLabel="Update status">
              <input name="registrationId" type="hidden" value={registration.id} />
              <fieldset className="flex flex-wrap gap-4">
                {REGISTRATION_STATUSES.map((value) => (
                  <Label className="flex items-center gap-2 font-normal" key={value}>
                    <input defaultChecked={registration.registration_status === value} name="status" type="radio" value={value} />
                    {REGISTRATION_STATUS_LABELS[value]}
                  </Label>
                ))}
              </fieldset>
            </SeminarForm>
          </AdminFormSection>

          <AdminFormSection title="Payment">
            <p className="text-sm">Status: <strong>{PAYMENT_STATUS_LABELS[registration.payment_status]}</strong></p>
            <p className="text-sm">Amount due: <strong>{money(registration.expected_amount_cents, registration.currency)}</strong></p>
            {registration.paid_at ? <p className="text-sm">Paid at: {new Date(registration.paid_at).toLocaleString()}</p> : null}
            {registration.payment_reference ? <p className="text-sm">Reference: {registration.payment_reference}</p> : null}
            {MARKABLE_PAID_STATUSES.includes(registration.payment_status) ? (
              <SeminarForm action={recordManualSeminarPaymentAction} submitLabel="Mark paid">
                <input name="registrationId" type="hidden" value={registration.id} />
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="method">Payment received via</Label>
                    <PaymentMethodSelect
                      className={SELECT_CLASSNAME}
                      defaultValue="bank_transfer"
                      id="method"
                      name="method"
                      options={MANUAL_PAYMENT_METHODS}
                    />
                  </div>
                  <div className="space-y-1.5"><Label htmlFor="reference">Reference (optional)</Label><Input id="reference" maxLength={1000} name="reference" /></div>
                </div>
              </SeminarForm>
            ) : registration.payment_status === 'paid' ? (
              <SeminarRefundForm registrationId={String(registration.id)} />
            ) : null}
          </AdminFormSection>
      </div>
    </AdminFormDrawer>
  );
}
