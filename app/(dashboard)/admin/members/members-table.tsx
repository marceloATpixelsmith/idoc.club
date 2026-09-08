'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { AdminMemberRow } from '@/lib/membership/admin-memberships';

type Filters = {
  country?: string; expiresFrom?: string; expiresTo?: string; federation?: string; membershipType?: string;
  page: number; q?: string; region?: string; sort: string; status: string;
};
const OPTIONAL_COLUMNS = ['status', 'expires', 'type', 'federation', 'country', 'region'] as const;
type Column = typeof OPTIONAL_COLUMNS[number];
const LABELS: Record<string, string> = { country: 'Country', expires: 'Expires', expiresFrom: 'Expires from', expiresTo: 'Expires through', federation: 'Federation', membershipType: 'Member type', q: 'Search', region: 'Region', status: 'Status', type: 'Type' };

function paramsWithoutPage(filters: Filters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (key !== 'page' && value) params.set(key, String(value));
  return params;
}

export function MembersTable({ filters, pageSize, rows, total }: { filters: Filters; pageSize: number; rows: AdminMemberRow[]; total: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [visible, setVisible] = useState<Set<Column>>(new Set(OPTIONAL_COLUMNS));
  const ids = rows.map((row) => row.profileId);
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  const activeFilters = Object.entries(filters).filter(([key, value]) => !['page', 'sort'].includes(key) && value && !(key === 'status' && value === 'active'));
  const base = useMemo(() => paramsWithoutPage(filters), [filters]);
  const navigate = (params: URLSearchParams) => router.push(`${pathname}?${params}`);
  const removeFilter = (key: string) => { const params = new URLSearchParams(searchParams); params.delete(key); params.delete('page'); navigate(params); };
  const pageHref = (page: number) => { const params = new URLSearchParams(base); params.set('page', String(page)); return `${pathname}?${params}`; };
  const start = total === 0 ? 0 : (filters.page - 1) * pageSize + 1;
  const end = Math.min(filters.page * pageSize, total);
  const detailHref = (id: number) => { const params = new URLSearchParams(base); params.set('page', String(filters.page)); params.set('profileId', String(id)); return `${pathname}?${params}`; };

  return <>
    <form className="mt-5 rounded-xl border bg-background p-4" method="get">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-64 flex-1 text-sm">Name or email<input className="mt-1 block w-full rounded-md border px-3 py-2" defaultValue={filters.q} name="q" type="search" /></label>
        <label className="text-sm">Status<select className="mt-1 block rounded-md border px-3 py-2" defaultValue={filters.status} name="status">{['active','never_paid','grace','expired','review_required','paused','suspended','revoked','archived','deleted'].map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>
        <details className="relative"><summary className="cursor-pointer list-none rounded-md border px-4 py-2 text-sm">Filters</summary><div className="absolute right-0 z-10 mt-2 grid w-[min(38rem,85vw)] gap-3 rounded-lg border bg-background p-4 shadow-lg sm:grid-cols-2">
          <fieldset className="contents"><legend className="col-span-full font-medium">Expiration date range</legend><label className="text-sm">From<input className="mt-1 block w-full rounded-md border px-2 py-1.5" defaultValue={filters.expiresFrom} name="expiresFrom" type="date" /></label><label className="text-sm">Through<input className="mt-1 block w-full rounded-md border px-2 py-1.5" defaultValue={filters.expiresTo} name="expiresTo" type="date" /></label></fieldset>
          {['federation','country','region'].map((name) => <label className="text-sm capitalize" key={name}>{name}<input className="mt-1 block w-full rounded-md border px-2 py-1.5" defaultValue={filters[name as keyof Filters]} list={`${name}-values`} maxLength={name === 'region' ? 40 : 2} name={name} /></label>)}
          <label className="text-sm">Member type<select className="mt-1 block w-full rounded-md border px-2 py-1.5" defaultValue={filters.membershipType ?? ''} name="membershipType"><option value="">All</option><option value="judge">Judge</option><option value="steward">Steward</option><option value="combo">Judge &amp; Steward</option><option value="veterinarian">Veterinarian</option></select></label>
        </div></details>
        <label className="text-sm">Sort<select className="mt-1 block rounded-md border px-3 py-2" defaultValue={filters.sort} name="sort"><option value="name_asc">Name A–Z</option><option value="name_desc">Name Z–A</option><option value="expires_asc">Expiration earliest</option><option value="expires_desc">Expiration latest</option></select></label>
        <button className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground" type="submit">Apply</button>
      </div>
    </form>
    <div className="mt-3 flex min-h-9 flex-wrap items-center gap-2" aria-label="Active filters">{activeFilters.map(([key, value]) => <button className="rounded-full border px-3 py-1 text-xs" key={key} onClick={() => removeFilter(key)} type="button">{LABELS[key] ?? key}: {String(value)} <span aria-hidden="true">×</span><span className="sr-only">Remove</span></button>)}{activeFilters.length > 0 && <Link className="text-sm underline" href={`${pathname}?status=active`}>Clear all</Link>}</div>
    <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-sm"><span>{start}–{end} of {total} members</span><div className="flex gap-3"><details className="relative"><summary className="cursor-pointer list-none rounded-md border px-3 py-2">Columns</summary><fieldset className="absolute right-0 z-10 mt-2 w-48 rounded-lg border bg-background p-3 shadow-lg"><legend className="font-medium">Visible columns</legend>{OPTIONAL_COLUMNS.map((column) => <label className="mt-2 flex gap-2 capitalize" key={column}><input checked={visible.has(column)} onChange={() => setVisible((current) => { const next = new Set(current); next.has(column) ? next.delete(column) : next.add(column); return next; })} type="checkbox" />{column}</label>)}</fieldset></details><Link className="rounded-md border px-3 py-2" download href={`/api/admin/export/members?${base}`}>Export filtered CSV</Link></div></div>
    {selected.size > 0 && <div className="mt-3 flex items-center gap-3 rounded-lg border border-gold bg-surface p-3 text-sm" role="status"><strong>{selected.size} selected</strong><button className="underline" onClick={() => setSelected(new Set())} type="button">Clear selection</button><button className="rounded border px-3 py-1" disabled title="Unavailable pending policy decisions" type="button">Bulk actions unavailable pending policy decisions</button></div>}
    <div className="mt-2 overflow-x-auto"><table className="min-w-full border text-sm"><thead><tr><th className="p-2 text-left"><input aria-label="Select all members on this page" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(ids))} type="checkbox" /></th><th className="p-2 text-left">Member</th>{OPTIONAL_COLUMNS.map((column) => visible.has(column) && <th className="p-2 text-left capitalize" key={column}>{column}</th>)}</tr></thead><tbody>{rows.length === 0 ? <tr><td className="p-6 text-center text-muted-foreground" colSpan={8}>No members match these filters. Remove a filter or clear all to see the default roster.</td></tr> : rows.map((member) => <tr className="border-t" key={member.profileId}><td className="p-2"><input aria-label={`Select ${member.firstName} ${member.lastName}`} checked={selected.has(member.profileId)} onChange={() => setSelected((current) => { const next = new Set(current); next.has(member.profileId) ? next.delete(member.profileId) : next.add(member.profileId); return next; })} type="checkbox" /></td><td className="p-2"><Link className="underline" href={detailHref(member.profileId)}>{member.firstName} {member.lastName}</Link><span className="block text-muted-foreground">{member.email}</span></td>{visible.has('status') && <td className="p-2">{member.status}</td>}{visible.has('expires') && <td className="p-2">{member.validUntil ?? '—'}</td>}{visible.has('type') && <td className="p-2">{member.membershipType ?? '—'}</td>}{visible.has('federation') && <td className="p-2">{member.federation ?? '—'}</td>}{visible.has('country') && <td className="p-2">{member.country}</td>}{visible.has('region') && <td className="p-2">{member.region ?? '—'}</td>}</tr>)}</tbody></table></div>
    <nav aria-label="Member pagination" className="mt-4 flex items-center justify-between text-sm"><span aria-live="polite">Showing {start}–{end} of {total}</span><span className="flex gap-3">{filters.page > 1 && <Link className="rounded border px-3 py-2" href={pageHref(filters.page - 1)}>Previous</Link>}{end < total && <Link className="rounded border px-3 py-2" href={pageHref(filters.page + 1)}>Next</Link>}</span></nav>
  </>;
}
