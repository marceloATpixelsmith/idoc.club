'use client';

import { useEffect } from 'react';
import type { AdminTableIdentifier, TablePreferenceState } from '@/lib/admin/table-preferences';
import { readCsrfTokenFromDocumentCookie } from '@/lib/security/csrf-client';

export const TABLE_PREFERENCE_EVENT = 'idoc:table-preference';

export function persistTablePreferences(table: AdminTableIdentifier, preferences: TablePreferenceState) {
  return fetch(`/api/admin/table-preferences/${table}`, {
    body: JSON.stringify(preferences), credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-idoc-csrf': readCsrfTokenFromDocumentCookie() }, method: 'PUT',
  });
}

export function TablePreferenceSync({ table }: { table: AdminTableIdentifier }) {
  useEffect(() => {
    const submit = (event: SubmitEvent) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || form.dataset.tablePreferences !== table) return;
      const state: TablePreferenceState = {};
      new FormData(form).forEach((value, key) => {
        if (key === 'page' || key === 'profileId' || key === 'csrf_token' || !(typeof value === 'string') || !value) return;
        if (key === 'column') (state.columns ??= [] as string[] as never, (state.columns as string[]).push(value));
        else state[key] = key === 'pageSize' ? Number(value) : value;
      });
      void persistTablePreferences(table, state);
    };
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<TablePreferenceState>).detail;
      if (detail) void persistTablePreferences(table, detail);
    };
    document.addEventListener('submit', submit);
    window.addEventListener(TABLE_PREFERENCE_EVENT, changed);
    return () => { document.removeEventListener('submit', submit); window.removeEventListener(TABLE_PREFERENCE_EVENT, changed); };
  }, [table]);
  return null;
}
