'use client';

import { useState } from 'react';
import { AdminFormDrawer } from '@/components/admin/admin-form-drawer';
import { AdminFormSection } from '@/components/admin/admin-form-section';
import { Label } from '@/components/ui/label';
import { PaymentMethodSelect } from '@/components/seminars/payment-method-select';
import { SeminarForm } from '@/components/seminars/seminar-form';
import { APPROVAL_STATUS_LABELS, FEI_APPROVAL_STATUSES } from '@/lib/seminars/status';
import { createAdminSeminarRegistrationAction } from '../actions';
import { MemberLookup } from './member-lookup';

const SELECT_CLASSNAME = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30';
export function RegistrationCreateDrawer({ paymentMethods, seminars }: {
  paymentMethods: Array<{ canonical_id: string; display_label: string }>;
  seminars: Array<{ id: number; isFei: boolean; title: string }>;
}) {
  const [seminarId, setSeminarId] = useState('');
  const isFei = seminars.find((seminar) => String(seminar.id) === seminarId)?.isFei ?? false;
  const approvalOptions = isFei ? FEI_APPROVAL_STATUSES : (['confirmed'] as const);
  return (
    <AdminFormDrawer closeHref="/admin/seminars/registrations" title="Registration">
      <div className="space-y-4 px-5 py-6 lg:px-8">
        <AdminFormSection
          description="Registrations are for active members only. Look up the member; the registration is attached to their membership (so it shows in their My Seminars/Courses) and they receive the same confirmation email as a self-registration."
          title="Registration Details"
        >
          <SeminarForm action={createAdminSeminarRegistrationAction} submitLabel="Create Registration">
            <MemberLookup />
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="seminarId">Seminar/Course</Label>
                <select className={SELECT_CLASSNAME} id="seminarId" name="seminarId" onChange={(event) => setSeminarId(event.target.value)} required value={seminarId}>
                  <option disabled value="">Choose a seminar/course</option>
                  {seminars.map((seminar) => <option key={seminar.id} value={seminar.id}>{seminar.title}</option>)}
                </select>
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
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="approvalStatus">Registration Status</Label>
                <select className={SELECT_CLASSNAME} id="approvalStatus" key={isFei ? 'fei' : 'standard'} name="approvalStatus" required>
                  {approvalOptions.map((value) => <option key={value} value={value}>{APPROVAL_STATUS_LABELS[value]}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="paymentStatus">Payment Status</Label>
                <select className={SELECT_CLASSNAME} defaultValue="pending" id="paymentStatus" name="paymentStatus" required>
                  <option value="pending">Pending (awaiting payment)</option>
                  <option value="paid">Paid</option>
                </select>
              </div>
            </div>
            {paymentMethods.length === 0 ? <p className="text-sm text-destructive">Enable Bank Transfer or Cash in Organization Settings before creating a registration.</p> : null}
          </SeminarForm>
        </AdminFormSection>
      </div>
    </AdminFormDrawer>
  );
}
