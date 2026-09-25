'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

/**
 * The server's `many()` filter parser (lib/admin/resource-list-query.ts) and this repo's admin
 * tables both treat a raw repeated query key (?status=a&status=b) the same as the toolbar's own
 * comma-joined form (?status=a,b) -- but `useDataTable`'s nuqs-backed facet state only ever reads
 * a single value per key, so it hydrates from just the first occurrence of a repeated key. That
 * leaves the toolbar showing an incomplete selection while the server applies the full one, and
 * the next filter change would silently narrow the URL down to what the toolbar (wrongly) saw.
 * Canonicalizing any repeated key to the comma-joined form as soon as the page mounts closes that
 * gap: nuqs re-parses the corrected URL immediately after.
 */
export function useCanonicalizeMultiSelectParams(keys: readonly string[]) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    let changed = false;
    for (const key of keys) {
      const values = params.getAll(key);
      if (values.length > 1) {
        params.delete(key);
        params.set(key, values.join(','));
        changed = true;
      }
    }
    if (changed) router.replace(`${pathname}?${params}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the raw query string should re-run this, not the identity of `keys`/`router`/`pathname`.
  }, [searchParams]);
}
