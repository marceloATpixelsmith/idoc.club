'use client';

import { useState } from 'react';
import { AdminFormDrawer } from '@/components/admin/admin-form-drawer';
import { AdminFormSection } from '@/components/admin/admin-form-section';
import { Input } from '@/components/ui/input';
import { InternationalPhoneInput } from '@/components/ui/international-phone-input';
import { Label } from '@/components/ui/label';
import { PaymentMethodSelect } from '@/components/seminars/payment-method-select';
import { SeminarForm } from '@/components/seminars/seminar-form';
import { createAdminSeminarRegistrationAction } from '../actions';

const SELECT_CLASSNAME = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30';
export function RegistrationCreateDrawer({ paymentMethods, seminars }: {
  paymentMethods: Array<{ canonical_id: string; display_label: string }>;
  seminars: Array<{ id: number; title: string }>;
}) {
  const [phone, setPhone] = useState('');

  return (
    <AdminFormDrawer closeHref="/admin/seminars/registrations" title="Registration">
      <div className="space-y-4 px-5 py-6 lg:px-8">
        <AdminFormSection
          description="If the email belongs to an IDOC member, the registration is attached to that member automatically and uses the member price. Otherwise it is created as a guest registration."
          title="Registration Details"
        >
          <SeminarForm action={createAdminSeminarRegistrationAction} submitLabel="Create Registration">
            <div className="space-y-1.5">
              <Label htmlFor="seminarId">Seminar</Label>
              <select className={SELECT_CLASSNAME} id="seminarId" name="seminarId" required defaultValue="">
                <option disabled value="">Choose a seminar</option>
                {seminars.map((seminar) => <option key={seminar.id} value={seminar.id}>{seminar.title}</option>)}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="firstName">First Name</Label>
              <Input id="firstName" maxLength={100} name="firstName" required />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="lastName">Last Name</Label>
              <Input id="lastName" maxLength={100} name="lastName" required />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" maxLength={255} name="email" required type="email" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <InternationalPhoneInput id="phone" name="phone" onChange={setPhone} required value={phone} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="paymentMethod">Payment Method</Label>
              <PaymentMethodSelect
                className={SELECT_CLASSNAME}
                defaultValue={paymentMethods[0]?.canonical_id ?? ''}
                id="paymentMethod"
                name="paymentMethod"
                options={paymentMethods.map((method) => ({ label: method.display_label, value: method.canonical_id }))}
              />
              {paymentMethods.length === 0 ? <p className="text-sm text-destructive">Enable Bank Transfer or Cash in Organization Settings before creating a registration.</p> : null}
            </div>
          </SeminarForm>
        </AdminFormSection>
      </div>
    </AdminFormDrawer>
  );
}
