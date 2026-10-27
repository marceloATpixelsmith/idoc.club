'use client';

import { AdminReadOnlyTable, type ReadOnlyRow } from '@/components/admin/admin-read-only-table';
import type { TablePreferenceState } from '@/lib/admin/table-preferences';

/** The Communications lists on the shared administrator report table (search, sort, column filters, date range, pagination). Rows are plain strings so they cross the server/client boundary. */
export function SentNoticesTable({ initialPreferences, rows }: { initialPreferences?: TablePreferenceState | null; rows: ReadOnlyRow[] }) {
  return (
    <AdminReadOnlyTable
      columns={[{ id: 'sent', label: 'Sent' }, { id: 'notice', label: 'Notice' }, { id: 'member', label: 'Member' }, { id: 'email', label: 'Email' }, { id: 'queue', label: 'Queue' }, { id: 'brevo', label: 'Brevo log' }]}
      dateColumn="sent"
      empty="No renewal notices were sent in this period."
      initialPreferences={initialPreferences}
      preferenceKey="communications_renewal_notices"
      filterColumns={['notice', 'brevo']}
      rows={rows}
      searchLabel="Search renewal notices"
      statusColumn="queue"
    />
  );
}

export function UpcomingNoticesTable({ initialPreferences, rows }: { initialPreferences?: TablePreferenceState | null; rows: ReadOnlyRow[] }) {
  return (
    <AdminReadOnlyTable
      columns={[{ id: 'goesOut', label: 'Goes out' }, { id: 'notice', label: 'Notice' }, { id: 'member', label: 'Member' }, { id: 'email', label: 'Email' }, { id: 'target', label: 'Renewal / expiry date' }]}
      dateColumn="goesOut"
      empty="No renewal notices are scheduled for this period."
      initialPreferences={initialPreferences}
      preferenceKey="communications_upcoming_notices"
      filterColumns={['notice']}
      rows={rows}
      searchLabel="Search upcoming notices"
      statusColumn="notice"
    />
  );
}

export function DeliveryIssuesTable({ initialPreferences, rows }: { initialPreferences?: TablePreferenceState | null; rows: ReadOnlyRow[] }) {
  return (
    <AdminReadOnlyTable
      columns={[{ id: 'sent', label: 'Sent' }, { id: 'group', label: 'Group' }, { id: 'notice', label: 'Email type' }, { id: 'member', label: 'Member concerned' }, { id: 'email', label: 'Recipient email' }, { id: 'queue', label: 'Queue' }, { id: 'brevo', label: 'Brevo log' }]}
      dateColumn="sent"
      empty="No matching delivery issues."
      initialPreferences={initialPreferences}
      preferenceKey="communications_delivery_issues"
      filterColumns={['group', 'notice', 'brevo']}
      rows={rows}
      searchLabel="Search delivery issues"
      statusColumn="queue"
    />
  );
}

/** Repeat requests are a support signal, not evidence of an email transport failure. */
export function RepeatedActivationTable({ rows }: { rows: ReadOnlyRow[] }) {
  return (
    <AdminReadOnlyTable
      columns={[{ id: 'lastRequested', label: 'Last requested' }, { id: 'member', label: 'Member concerned' }, { id: 'email', label: 'Recipient email' }, { id: 'requests', label: 'Requests (7 days)' }, { id: 'sent', label: 'Sent' }, { id: 'account', label: 'Account status' }]}
      dateColumn="lastRequested"
      empty="No still-unactivated accounts with repeated activation requests."
      preferenceKey="communications_repeated_activations"
      rows={rows}
      searchLabel="Search repeated activation requests"
    />
  );
}
