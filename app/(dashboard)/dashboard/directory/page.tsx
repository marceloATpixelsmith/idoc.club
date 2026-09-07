import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getOwnPrivateMember, requireAccountAccess } from '@/lib/membership/data-access';
import { isPrivilegedActor } from '@/lib/membership/account-access';
import { isEntitled } from '@/lib/membership/entitlement';
import { getUser } from '@/lib/db/queries';
import { COUNTRY_OPTIONS, countryNameForCode } from '@/lib/membership/countries';
import { IDOC_REGIONS } from '@/lib/membership/validation';
import {
  DirectoryRateLimitedError, listMemberDirectory, MEMBERSHIP_TYPE_FILTERS,
  type DirectoryRoleDetail, type MemberDirectoryFilters,
} from '@/lib/directory/member-directory';

const MEMBERSHIP_TYPE_LABELS: Record<string, string> = {
  combo: 'Judge + Steward', judge: 'Judge', steward: 'Steward', veterinarian: 'Veterinarian',
};

function roleLabel(role: DirectoryRoleDetail) {
  const type = MEMBERSHIP_TYPE_LABELS[role.roleType] ?? role.roleType;
  return role.officialStatuses && role.officialStatuses.length > 0 ? `${type} — ${role.officialStatuses.join(', ')}` : type;
}

// searchParams values are string | string[] | undefined at runtime (a repeated query key becomes
// an array); an array is never a meaningful single form-field default, so it displays as unset.
function displayValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? undefined : value;
}

export default async function MemberDirectoryPage({ searchParams }: { searchParams: Promise<MemberDirectoryFilters> }) {
  const user = await getUser();
  if (user?.accountState === 'onboarding') redirect('/dashboard');
  const actor = await requireAccountAccess('profile');
  const privileged = isPrivilegedActor(actor);
  const member = await getOwnPrivateMember();
  // An administrator/super_admin is never a member and must never be gated by membership payment
  // status -- this is the same "unauthorized" enforcement point every other member-only dashboard
  // surface uses (see dashboard/seminars/page.tsx), not just UI hiding: lib/directory/member-directory.ts's
  // listMemberDirectory independently re-asserts requireAccountAccess('member') server-side regardless
  // of this page's own check.
  if (!member && !privileged) redirect('/dashboard');
  if (member && !privileged && !isEntitled(member.entitlement, new Date().toISOString().slice(0, 10))) redirect('/dashboard');

  const params = await searchParams;
  let listing: Awaited<ReturnType<typeof listMemberDirectory>> | null = null;
  let rateLimited = false;
  try {
    listing = await listMemberDirectory(params);
  } catch (error) {
    if (!(error instanceof DirectoryRateLimitedError)) throw error;
    rateLimited = true;
  }

  const paginationHref = (page: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(listing?.filters ?? params)) {
      if (key !== 'page' && value !== undefined && value !== '') query.set(key, String(value));
    }
    query.set('page', String(page));
    return `?${query}`;
  };

  return (
    <main className="flex-1 p-4 lg:p-8">
      <h1 className="text-2xl font-semibold">Members Directory</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Search current IDOC officials by membership type, federation, country and region. Contact
        details and addresses are never shown here.
      </p>

      <form method="get" className="mt-6 grid gap-3 rounded-lg border p-4 md:grid-cols-4">
        <label className="text-sm md:col-span-2">
          Name
          <input className="mt-1 block w-full rounded-md border p-2" defaultValue={displayValue(params.q)} name="q" type="search" />
        </label>
        <label className="text-sm">
          Membership type
          <select className="mt-1 block w-full rounded-md border p-2" defaultValue={displayValue(params.membershipType) ?? ''} name="membershipType">
            <option value="">All</option>
            {MEMBERSHIP_TYPE_FILTERS.map((type) => <option key={type} value={type}>{MEMBERSHIP_TYPE_LABELS[type]}</option>)}
          </select>
        </label>
        <label className="text-sm">
          Country
          <select className="mt-1 block w-full rounded-md border p-2" defaultValue={displayValue(params.country) ?? ''} name="country">
            <option value="">All</option>
            {COUNTRY_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.name}</option>)}
          </select>
        </label>
        <label className="text-sm">
          Federation
          <select className="mt-1 block w-full rounded-md border p-2" defaultValue={displayValue(params.federation) ?? ''} name="federation">
            <option value="">All</option>
            {COUNTRY_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.name}</option>)}
          </select>
        </label>
        <label className="text-sm">
          IDOC Region
          <select className="mt-1 block w-full rounded-md border p-2" defaultValue={displayValue(params.region) ?? ''} name="region">
            <option value="">All</option>
            {IDOC_REGIONS.map((region) => <option key={region} value={region}>{region}</option>)}
          </select>
        </label>
        <button className="self-end rounded-md border px-3 py-2 text-sm" type="submit">Apply filters</button>
      </form>

      {rateLimited ? (
        <p className="mt-8 border border-border bg-surface/50 p-6 text-sm text-muted-foreground">
          Too many searches in a short time. Please wait a few minutes and try again.
        </p>
      ) : !listing || listing.rows.length === 0 ? (
        <p className="mt-8 text-muted-foreground">No members match these filters.</p>
      ) : (
        <>
          <p className="mt-6 text-sm text-muted-foreground">{listing.total} matching members</p>
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full border text-sm">
              <thead>
                <tr>
                  <th className="p-2 text-left">Name</th>
                  <th className="p-2 text-left">Country</th>
                  <th className="p-2 text-left">Role</th>
                  <th className="p-2 text-left">Federation</th>
                  <th className="p-2 text-left">Region</th>
                </tr>
              </thead>
              <tbody>
                {listing.rows.map((row, index) => (
                  // No stable per-row identifier is ever selected from the database (see
                  // lib/directory/member-directory.ts) -- the row's position within this one page is
                  // a safe, non-identifying React key.
                  <tr className="border-t" key={index}>
                    <td className="p-2 font-medium">{row.firstName} {row.lastName}</td>
                    <td className="p-2">{countryNameForCode(row.country)}</td>
                    <td className="p-2">{row.roles && row.roles.length > 0 ? row.roles.map(roleLabel).join('; ') : '—'}</td>
                    <td className="p-2">{row.federation ? countryNameForCode(row.federation) : '—'}</td>
                    <td className="p-2">{row.region ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav className="mt-4 flex gap-3 text-sm" aria-label="Pagination">
            {listing.filters.page > 1 && <Link className="underline" href={paginationHref(listing.filters.page - 1)}>Previous</Link>}
            {listing.filters.page < listing.maxPage && listing.filters.page * listing.pageSize < listing.total && (
              <Link className="underline" href={paginationHref(listing.filters.page + 1)}>Next</Link>
            )}
          </nav>
        </>
      )}
    </main>
  );
}
