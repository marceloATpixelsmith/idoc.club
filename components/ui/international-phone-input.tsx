'use client';

import { useMemo, useState } from 'react';
import { ChevronsUpDown, Search } from 'lucide-react';
import { COUNTRY_OPTIONS } from '@/lib/membership/countries';
import { COUNTRY_CALLING_CODES, KNOWN_CALLING_CODES } from '@/lib/phone-country-codes';
import { cn } from '@/lib/utils';

function flagEmoji(code: string) {
  return code.toUpperCase().replace(/./g, (character) => String.fromCodePoint(127397 + character.charCodeAt(0)));
}

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
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');
  const callingCode = countryCode ? COUNTRY_CALLING_CODES[countryCode as keyof typeof COUNTRY_CALLING_CODES] ?? '' : '';
  const selectedCountry = COUNTRY_OPTIONS.find(({ code }) => code === countryCode);
  const filteredCountries = useMemo(() => {
    const query = countrySearch.trim().toLowerCase();
    return COUNTRY_OPTIONS.filter(({ code, name: countryName }) => {
      const calling = COUNTRY_CALLING_CODES[code as keyof typeof COUNTRY_CALLING_CODES];
      return calling && (!query || countryName.toLowerCase().includes(query) || code.toLowerCase().includes(query) || calling.includes(query));
    });
  }, [countrySearch]);

  function emit(nextCountryCode: string, nextNationalNumber: string) {
    const prefix = nextCountryCode ? COUNTRY_CALLING_CODES[nextCountryCode as keyof typeof COUNTRY_CALLING_CODES] ?? '' : '';
    onChange(prefix && nextNationalNumber ? `${prefix}${nextNationalNumber}` : '');
  }

  function selectCountry(nextCountryCode: string) {
    setCountryCode(nextCountryCode);
    setCountryPickerOpen(false);
    setCountrySearch('');
    emit(nextCountryCode, nationalNumber);
  }

  return (
    <div className={cn('flex w-full', className)}>
      <div className="relative">
        <button
          aria-expanded={countryPickerOpen}
          aria-haspopup="listbox"
          aria-label="Choose phone country"
          className="flex h-11 min-w-[5.25rem] items-center gap-2 rounded-l-md border border-r-0 border-input bg-surface px-3 text-sm text-foreground transition-colors hover:bg-muted/50 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setCountryPickerOpen((open) => !open)}
          type="button"
        >
          <span aria-hidden className="text-base">{countryCode ? flagEmoji(countryCode) : '🌐'}</span>
          <span>{callingCode || ''}</span>
          <ChevronsUpDown aria-hidden className="ml-auto h-4 w-4 text-muted-foreground" />
        </button>
        {countryPickerOpen ? (
          <div className="absolute left-0 top-full z-50 mt-1 w-[min(22rem,calc(100vw-3rem))] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg">
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                aria-label="Search countries"
                autoFocus
                className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                onChange={(event) => setCountrySearch(event.target.value)}
                placeholder="Search country or code"
                value={countrySearch}
              />
            </div>
            <div className="max-h-64 overflow-y-auto p-1" role="listbox">
              {filteredCountries.map(({ code, name: countryName }) => (
                <button
                  aria-selected={code === countryCode}
                  className="flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-none"
                  key={code}
                  onClick={() => selectCountry(code)}
                  role="option"
                  type="button"
                >
                  <span aria-hidden className="w-6 text-base">{flagEmoji(code)}</span>
                  <span className="min-w-0 flex-1 truncate">{countryName}</span>
                  <span className="shrink-0 text-muted-foreground">{COUNTRY_CALLING_CODES[code as keyof typeof COUNTRY_CALLING_CODES]}</span>
                </button>
              ))}
              {filteredCountries.length === 0 ? <p className="px-2 py-3 text-sm text-muted-foreground">No countries found.</p> : null}
            </div>
          </div>
        ) : null}
      </div>
      <div className="flex h-11 min-w-0 flex-1 items-center rounded-r-md border border-input bg-surface focus-within:z-10 focus-within:ring-2 focus-within:ring-ring">
        <input
          autoComplete="tel-national"
          className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          id={id}
          inputMode="tel"
          onChange={(event) => {
            const nextNationalNumber = event.target.value.replace(/\D/g, '').slice(0, 15);
            setNationalNumber(nextNationalNumber);
            emit(countryCode, nextNationalNumber);
          }}
          placeholder="Phone number"
          required={required}
          type="tel"
          value={nationalNumber}
        />
      </div>
      <input
        aria-hidden
        className="pointer-events-none absolute h-px w-px opacity-0"
        name={name}
        onChange={() => undefined}
        required={required}
        tabIndex={-1}
        value={value}
      />
    </div>
  );
}
