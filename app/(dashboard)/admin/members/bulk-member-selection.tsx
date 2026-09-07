export const MAX_ADMIN_MEMBER_BATCH_SIZE = 50;

export function BulkMemberSelection() {
  return <form className="mt-3 rounded-lg border p-3" id="bulk-member-actions">
    <fieldset>
      <legend className="px-1 font-medium">Bulk actions</legend>
      <p className="text-sm">Select up to {MAX_ADMIN_MEMBER_BATCH_SIZE} roster records. Every future action will re-fetch and re-authorize each stable profile ID on the server.</p>
      <div className="mt-3 grid gap-2 text-sm">
        <button className="rounded border px-3 py-2 text-left" disabled type="button">Bulk Revoke — unavailable: no approved general Revoke User operation exists</button>
        <button className="rounded border px-3 py-2 text-left" disabled type="button">Archive Membership — unavailable: external-operation and seminar snapshot dependencies remain</button>
        <button className="rounded border px-3 py-2 text-left" disabled type="button">Pause Membership — unavailable: product rules are not defined</button>
      </div>
    </fieldset>
  </form>;
}
