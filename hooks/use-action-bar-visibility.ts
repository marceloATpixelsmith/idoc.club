import { useEffect, useRef, useState } from 'react';

/**
 * Dismissing the bulk-action bar (its close icon) should hide it without clearing the row
 * selection underneath -- only an explicit "Clear selection" action should do that. The bar
 * reappears the next time the selection count grows from zero, so a fresh selection always shows
 * it again.
 */
export function useActionBarVisibility(selectedCount: number) {
  const [dismissed, setDismissed] = useState(false);
  const previousCount = useRef(selectedCount);
  useEffect(() => {
    if (previousCount.current === 0 && selectedCount > 0) setDismissed(false);
    previousCount.current = selectedCount;
  }, [selectedCount]);
  return {
    open: selectedCount > 0 && !dismissed,
    onOpenChange: (open: boolean) => { if (!open) setDismissed(true); },
  };
}
