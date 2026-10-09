'use client';

import { Archive } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { bulkArchiveMembers, type BulkDeleteState } from '@/app/(dashboard)/admin/bulk-actions';
import { useFreshStepUpAction } from '@/components/auth/fresh-step-up-action';
import { useDataTableMutation } from '@/components/data-table/data-table';
import { ActionBarItem } from '@/components/ui/action-bar';
import { readCsrfTokenFromDocumentCookie } from '@/lib/security/csrf-client';

export function BulkArchiveMembersSelected({ clearSelection, ids }: { clearSelection: () => void; ids: string[] }) {
  const [state, run, pending, challenge] = useFreshStepUpAction<BulkDeleteState>(bulkArchiveMembers, {});
  const mutation = useDataTableMutation();
  const mutationStarted = useRef(false);

  useEffect(() => {
    if (!pending && mutationStarted.current) {
      mutationStarted.current = false;
      mutation.finish(Boolean(state.success));
      if (state.success) clearSelection();
      if (state.error) window.alert(state.error);
    }
  // clearSelection is read only when a new result arrives; table instances recreate callbacks during render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.error, state.success, pending]);

  function requestArchive(event: Event) {
    event.preventDefault();
    if (!ids.length || pending) return;
    if (!window.confirm('Archive ' + ids.length + ' selected member' + (ids.length === 1 ? '' : 's') + '? Their access will be removed and their records retained.')) return;
    mutationStarted.current = true;
    mutation.begin();
    const formData = new FormData();
    formData.set('csrf_token', readCsrfTokenFromDocumentCookie());
    formData.set('table', 'members');
    ids.forEach((id) => formData.append('id', id));
    run(formData);
  }

  return <>
    <ActionBarItem disabled={pending} onSelect={requestArchive}>
      <Archive aria-hidden="true" className="mr-2 size-4" />
      {pending ? 'Archiving…' : 'Archive selected'}
    </ActionBarItem>
    {challenge}
  </>;
}
