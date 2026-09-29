'use client';

import { useState } from 'react';
import { COUNTRY_OPTIONS } from '@/lib/membership/countries';
import { COUNTRY_CALLING_CODES, KNOWN_CALLING_CODES } from '@/lib/phone-country-codes';
import { cn } from '@/lib/utils';

function initialParts(value: string) {
  const callingCode = KNOWN_CALLING_CODES.find((candidate) => value.startsWith(candidate)) ?? '';
  const countryCode = COUNTRY_OPTIONS.find(({ code }) => COUNTRY_CALLING_CODES[code as keyof typeof COUNTRY_CALLING_CODES] === callingCode)?.code ?? '';
  return { countryCode, nationalNumber: callingCode ? value.slice(callingCode.length) : value.replace(/\D/g, '') };
}

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
  const initial = initialParts(value);
  const [countryCode, setCountryCode] = useState(initial.countryCode);
  const [nationalNumber, setNationalNumber] = useState(initial.nationalNumber);
  const callingCode = countryCode ? COUNTRY_CALLING_CODES[countryCode as keyof typeof COUNTRY_CALLING_CODES] ?? '' : '';

  function emit(nextCountryCode: string, nextNationalNumber: string) {
    const prefix = nextCountryCode ? COUNTRY_CALLING_CODES[nextCountryCode as keyof typeof COUNTRY_CALLING_CODES] ?? '' : '';
    onChange(prefix && nextNationalNumber ? `${prefix}${nextNationalNumber}` : '');
  }

  return (
    <div className={cn('flex w-full gap-2', className)}>
      <select
        aria-label="Phone country"
        className="h-9 min-w-0 basis-1/2 rounded-md border border-input bg-surface px-2 text-sm text-foreground"
        onChange={(event) => {
          const nextCountryCode = event.target.value;
          setCountryCode(nextCountryCode);
          emit(nextCountryCode, nationalNumber);
        }}
        required={required}
        value={countryCode}
      >
        <option value="">Country</option>
        {COUNTRY_OPTIONS.filter(({ code }) => code in COUNTRY_CALLING_CODES).map(({ code, name: countryName }) => (
          <option key={code} value={code}>{countryName} ({COUNTRY_CALLING_CODES[code as keyof typeof COUNTRY_CALLING_CODES]})</option>
        ))}
      </select>
      <div className="flex min-w-0 basis-1/2 items-center rounded-md border border-input bg-surface">
        <span className="pl-3 text-sm text-muted-foreground">{callingCode || '+'}</span>
        <input
          autoComplete="tel-national"
          className="h-9 min-w-0 flex-1 bg-transparent px-2 text-sm text-foreground outline-none"
          id={id}
          inputMode="tel"
          onChange={(event) => {
            const nextNationalNumber = event.target.value.replace(/\D/g, '').slice(0, 15);
            setNationalNumber(nextNationalNumber);
            emit(countryCode, nextNationalNumber);
          }}
          required={required}
          type="tel"
          value={nationalNumber}
        />
      </div>
      <input name={name} type="hidden" value={value} />
    </div>
  );
}
