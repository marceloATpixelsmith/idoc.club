'use client';

import { Archive } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';
import { bulkArchiveMembers, type BulkDeleteState } from '@/app/(dashboard)/admin/bulk-actions';
import { useDataTableMutation } from '@/components/data-table/data-table';
import { ActionBarItem } from '@/components/ui/action-bar';
import { useBrandedDialogs } from '@/components/ui/branded-dialogs';
import { readCsrfTokenFromDocumentCookie } from '@/lib/security/csrf-client';

export function BulkArchiveMembersSelected({ clearSelection, ids }: { clearSelection: () => void; ids: string[] }) {
  // Archiving keeps every record and is reversible, so it needs no authenticator code (permanent deletion does).
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<BulkDeleteState>({});
  const mutation = useDataTableMutation();
  const mutationStarted = useRef(false);
  const { alert, confirm, dialogs } = useBrandedDialogs();

  useEffect(() => {
    if (!pending && mutationStarted.current) {
      mutationStarted.current = false;
      mutation.finish(Boolean(state.success));
      if (state.success) clearSelection();
      if (state.error) alert(state.error, 'Could not archive');
    }
  // clearSelection is read only when a new result arrives; table instances recreate callbacks during render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.error, state.success, pending]);

  async function requestArchive(event: Event) {
    event.preventDefault();
    if (!ids.length || pending) return;
    if (!(await confirm({ title: 'Archive members', message: 'Archive ' + ids.length + ' selected member' + (ids.length === 1 ? '' : 's') + '? Their access will be removed and their records retained.', confirmLabel: 'Archive' }))) return;
    mutationStarted.current = true;
    mutation.begin();
    const formData = new FormData();
    formData.set('csrf_token', readCsrfTokenFromDocumentCookie());
    formData.set('table', 'members');
    ids.forEach((id) => formData.append('id', id));
    startTransition(async () => setState(await bulkArchiveMembers({}, formData)));
  }

  return <>
    <ActionBarItem disabled={pending} onSelect={requestArchive}>
      <Archive aria-hidden="true" className="mr-2 size-4" />
      {pending ? 'Archiving…' : 'Archive selected'}
    </ActionBarItem>
    {dialogs}
  </>;
}
