'use client';

import PhoneInput, { type Value } from 'react-phone-number-input/max';
import 'react-phone-number-input/style.css';
import { cn } from '@/lib/utils';

export function InternationalPhoneInput({
  className,
  id,
  name,
  onChange,
  required = false,
  value,
}: {
  className?: string;
  id: string;
  name: string;
  onChange: (value: string) => void;
  required?: boolean;
  value: string;
}) {
  return (
    <PhoneInput
      className={cn(
        'idoc-phone-input flex h-9 w-full rounded-md border border-input bg-surface px-3 py-1 text-sm text-foreground',
        className,
      )}
      defaultCountry="US"
      id={id}
      international
      name={name}
      onChange={(next: Value | undefined) => onChange(next ?? '')}
      required={required}
      value={(value || undefined) as Value | undefined}
    />
  );
}
