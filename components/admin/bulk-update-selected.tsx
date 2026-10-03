'use client';

import { CheckCircle2, RefreshCcw } from 'lucide-react';
import { useState, useTransition } from 'react';
import { bulkCloseSupportRows, bulkSetNewsStatus } from '@/app/(dashboard)/admin/bulk-actions';
import { ActionBarItem } from '@/components/ui/action-bar';
import { useDataTableMutation } from '@/components/data-table/data-table';
import { readCsrfTokenFromDocumentCookie } from '@/lib/security/csrf-client';

function selectionFormData(ids: string[]) {
  const formData = new FormData();
  formData.set('csrf_token', readCsrfTokenFromDocumentCookie());
  ids.forEach((id) => formData.append('id', id));
  return formData;
}

export function BulkCloseSupportSelected({ clearSelection, ids }: { clearSelection: () => void; ids: string[] }) {
  const [pending, startTransition] = useTransition();
  const mutation = useDataTableMutation();

  function closeSelected(event: Event) {
    event.preventDefault();
    if (!ids.length || pending) return;
    mutation.begin();
    startTransition(async () => {
      const result = await bulkCloseSupportRows({}, selectionFormData(ids));
      mutation.finish(Boolean(result.success));
      if (result.error) window.alert(result.error);
      if (result.success) clearSelection();
    });
  }

  return (
    <ActionBarItem disabled={pending} onSelect={closeSelected}>
      <CheckCircle2 aria-hidden="true" className="mr-2 size-4" />
      {pending ? 'Closing…' : 'Close selected'}
    </ActionBarItem>
  );
}

export function BulkNewsStatusSelected({ clearSelection, ids }: { clearSelection: () => void; ids: string[] }) {
  const [status, setStatus] = useState('draft');
  const [pending, startTransition] = useTransition();
  const mutation = useDataTableMutation();

  function applyStatus(event: Event) {
    event.preventDefault();
    if (!ids.length || pending) return;
    mutation.begin();
    startTransition(async () => {
      const formData = selectionFormData(ids);
      formData.set('status', status);
      const result = await bulkSetNewsStatus({}, formData);
      mutation.finish(Boolean(result.success));
      if (result.error) window.alert(result.error);
      if (result.success) clearSelection();
    });
  }

  return (
    <>
      <select
        aria-label="Status for selected News/Blog records"
        className="h-8 rounded-md border border-input bg-surface-raised px-2 text-sm"
        disabled={pending}
        onChange={(event) => setStatus(event.target.value)}
        value={status}
      >
        <option value="draft">Draft</option>
        <option value="scheduled">Scheduled</option>
        <option value="published">Published</option>
        <option value="archived">Archived</option>
      </select>
      <ActionBarItem disabled={pending} onSelect={applyStatus}>
        <RefreshCcw aria-hidden="true" className="mr-2 size-4" />
        {pending ? 'Applying…' : 'Apply status'}
      </ActionBarItem>
    </>
  );
}
