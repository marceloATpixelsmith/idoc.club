'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PaymentMethodSelect } from '@/components/seminars/payment-method-select';
import { SeminarForm } from '@/components/seminars/seminar-form';
import { seminarPaymentReferenceLabel } from '@/lib/seminars/payment-reference';
import { recordManualSeminarPaymentAction } from '../actions';

const SELECT_CLASSNAME = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30';
const METHODS = [{ label: 'Bank Transfer', value: 'bank_transfer' }, { label: 'Cash at the Event', value: 'cash_event' }] as const;

/** Records an offline (Bank Transfer / Cash) payment as received. The evidence is required and labelled for the method:
 * Bank Transfer Reference for a bank transfer, Receipt ID for cash. It clears when the method changes. */
export function RecordPaymentForm({ defaultMethod, registrationId }: { defaultMethod: string; registrationId: number }) {
  const [method, setMethod] = useState(METHODS.some((item) => item.value === defaultMethod) ? defaultMethod : 'bank_transfer');
  const [reference, setReference] = useState('');
  return (
    <SeminarForm action={recordManualSeminarPaymentAction} submitLabel="Record payment received">
      <input name="registrationId" type="hidden" value={registrationId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="method">Payment received via</Label>
          <PaymentMethodSelect
            className={SELECT_CLASSNAME} defaultValue={method} id="method" name="method"
            onValueChange={(value) => { setMethod(value); setReference(''); }} options={METHODS}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reference">{seminarPaymentReferenceLabel(method)}</Label>
          <Input id="reference" maxLength={1000} name="reference" onChange={(event) => setReference(event.target.value)} required value={reference} />
        </div>
      </div>
    </SeminarForm>
  );
}
