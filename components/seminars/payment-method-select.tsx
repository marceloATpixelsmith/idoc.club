'use client';

import { useState } from 'react';
import { PaymentMethodIcon } from '@/components/seminars/payment-method-icon';

export function PaymentMethodSelect({
  className,
  defaultValue,
  id,
  name,
  options,
}: {
  className: string;
  defaultValue: string;
  id: string;
  name: string;
  options: ReadonlyArray<{ label: string; value: string }>;
}) {
  const [value, setValue] = useState(defaultValue);

  return (
    <div className="relative">
      <PaymentMethodIcon className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-gold" method={value} />
      <select
        className={className + ' pl-10'}
        id={id}
        name={name}
        onChange={(event) => setValue(event.target.value)}
        required
        value={value}
      >
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  );
}
