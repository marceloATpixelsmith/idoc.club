'use client';

import { Trash2 } from 'lucide-react';
import { useEffect } from 'react';
import { bulkDeleteAdminRows, type BulkDeleteState } from '@/app/(dashboard)/admin/bulk-actions';
import { useFreshStepUpAction } from '@/components/auth/fresh-step-up-action';
import { ActionBarItem } from '@/components/ui/action-bar';
import { readCsrfTokenFromDocumentCookie } from '@/lib/security/csrf-client';

export function BulkDeleteSelected({ clearSelection, ids, table }: {
  clearSelection: () => void;
  ids: string[];
  table: 'members' | 'news' | 'registrations' | 'seminars' | 'support';
}) {
  const [state, run, pending, challenge] = useFreshStepUpAction<BulkDeleteState>(bulkDeleteAdminRows, {});

  useEffect(() => {
    if (state.success) clearSelection();
    if (state.error) window.alert(state.error);
  // clearSelection is intentionally read only when a new result arrives; table instances recreate callbacks during render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.error, state.success]);

  function requestDelete(event: Event) {
    // Keep the ActionBar mounted while the server action/MFA dialog runs; otherwise its portal
    // would close and unmount the component that owns the pending destructive action.
    event.preventDefault();
    if (!ids.length || pending) return;
    const label = ids.length === 1 ? 'record' : 'records';
    if (!window.confirm('Delete ' + ids.length + ' selected ' + label + '? Existing financial, audit, and retention protections still apply.')) return;
    const formData = new FormData();
    formData.set('csrf_token', readCsrfTokenFromDocumentCookie());
    formData.set('table', table);
    ids.forEach((id) => formData.append('id', id));
    run(formData);
  }

  return <>
    <ActionBarItem disabled={pending} onSelect={requestDelete}>
      <Trash2 aria-hidden="true" className="mr-2 size-4" />
      {pending ? 'Deleting…' : 'Delete selected'}
    </ActionBarItem>
    {challenge}
  </>;
}