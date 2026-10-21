'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { openDirectoryForCountry } from './open-directory-for-country';

type CountryOption = { countryCode: string; countryName: string; memberCount: number };

/** Visible, keyboard- and screen-reader-operable way to do what clicking a country's dot does (the
 * map canvas itself cannot take keyboard focus): choose a country, open the directory filtered to its
 * National Federation. Only rendered for signed-in members. */
export function CountryDirectoryPicker({ countries }: { countries: CountryOption[] }) {
  const router = useRouter();
  const [countryCode, setCountryCode] = useState('');
  const [failed, setFailed] = useState(false);
  const [opening, setOpening] = useState(false);

  async function open(event: React.FormEvent) {
    event.preventDefault();
    if (!countryCode) return;
    setOpening(true);
    setFailed(!(await openDirectoryForCountry(countryCode, (href) => router.push(href))));
    setOpening(false);
  }

  return <form className="mt-4 flex flex-wrap items-center gap-3" onSubmit={open}>
    <label className="text-sm text-muted-foreground" htmlFor="map-country-picker">View members in</label>
    <select
      className="h-9 min-w-56 rounded-md border border-border bg-background pl-3 pr-8 text-sm"
      id="map-country-picker"
      onChange={(event) => setCountryCode(event.target.value)}
      value={countryCode}
    >
      <option value="">Choose a country…</option>
      {countries.map((country) => <option key={country.countryCode} value={country.countryCode}>{country.countryName} ({country.memberCount})</option>)}
    </select>
    <Button disabled={!countryCode || opening} type="submit" variant="outline">View members</Button>
    {failed ? <span className="text-sm text-muted-foreground" role="alert">Could not open the directory. Please try again.</span> : null}
  </form>;
}
