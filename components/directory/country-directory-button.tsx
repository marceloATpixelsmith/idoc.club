'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { openDirectoryForCountry } from './open-directory-for-country';

/** Keyboard/screen-reader equivalent of clicking a country's dot on the map (signed-in members only). */
export function CountryDirectoryButton({ countryCode, countryName }: { countryCode: string; countryName: string }) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  return <>
    <button
      onClick={async () => setFailed(!(await openDirectoryForCountry(countryCode, (href) => router.push(href))))}
      type="button"
    >{countryName}</button>
    {failed ? <span role="alert"> Could not open the directory. Please try again.</span> : null}
  </>;
}
