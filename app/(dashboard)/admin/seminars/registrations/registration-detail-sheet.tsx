'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { SeminarForm } from '@/components/seminars/seminar-form';
import { SeminarRefundForm } from '@/components/seminars/refund-form';
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

function Section({ children, title }: { children: React.ReactNode; title: string }) {
  return <Card><CardHeader><CardTitle className="text-xs font-bold uppercase tracking-wider text-gold">{title}</CardTitle></CardHeader><CardContent className="space-y-4">{children}</CardContent></Card>;
}

export function RegistrationDetailSheet({ closeHref, paymentMethods, registration }: {
  closeHref: string; paymentMethods: Array<{ canonical_id: unknown; display_label: unknown }>; registration: AdminSeminarRegistrationRow;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const isGuest = registration.profile_id === null;
  return (
    <Sheet onOpenChange={(next) => { setOpen(next); if (!next) router.push(closeHref); }} open={open}>
      <SheetContent className="w-full overflow-y-auto sm:w-[70vw] sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{isGuest ? registration.guest_name : registration.member_name}</SheetTitle>
          <SheetDescription>
            <Link className="underline underline-offset-4" href={`/admin/seminars/${registration.seminar_id}`}>{registration.seminar_title}</Link>
            {' · '}{isGuest ? 'Guest' : 'Member'}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <Section title="Registrant details">
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
                <select className={SELECT_CLASSNAME} defaultValue={registration.payment_method_canonical_id} id="paymentMethod" name="paymentMethod" required>
                  {paymentMethods.map((method) => <option key={String(method.canonical_id)} value={String(method.canonical_id)}>{String(method.display_label)}</option>)}
                </select>
              </div>
            </SeminarForm>
          </Section>

          <Section title="Registration status">
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
          </Section>

          <Section title="Payment">
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
                    <select className={SELECT_CLASSNAME} defaultValue="bank_transfer" id="method" name="method" required>
                      {MANUAL_PAYMENT_METHODS.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5"><Label htmlFor="reference">Reference (optional)</Label><Input id="reference" maxLength={1000} name="reference" /></div>
                </div>
              </SeminarForm>
            ) : registration.payment_status === 'paid' ? (
              <SeminarRefundForm registrationId={String(registration.id)} />
            ) : null}
          </Section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
