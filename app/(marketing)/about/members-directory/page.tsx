import type { Metadata } from 'next';
import Link from 'next/link';
import { ConcentrationMap } from '@/components/directory/concentration-map';
import { PageHeader } from '@/components/site/PageHeader';
import { getUser } from '@/lib/db/queries';
import { getPublicMemberConcentration } from '@/lib/directory/aggregate';
import {
  DirectoryRateLimitedError,
  listMemberDirectory,
  MEMBERSHIP_TYPE_FILTERS,
  type DirectoryRoleDetail,
  type MemberDirectoryFilters,
} from '@/lib/directory/member-directory';
import { countryNameForCode, COUNTRY_OPTIONS } from '@/lib/membership/countries';
import { IDOC_REGIONS } from '@/lib/membership/validation';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'IDOC Members Directory — Officials Worldwide',
  description: 'A privacy-first map and member-only directory of IDOC officials worldwide.',
};

const TYPE_LABELS: Record<string, string> = {
  combo: 'Judge + Steward', judge: 'Judge', steward: 'Steward', veterinarian: 'Veterinarian',
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? undefined : value;
}

function roleLabel(role: DirectoryRoleDetail) {
  const type = TYPE_LABELS[role.roleType] ?? role.roleType;
  return role.officialStatuses?.length ? `${type} — ${role.officialStatuses.join(', ')}` : type;
}

type PageParams = MemberDirectoryFilters & { tab?: string | string[] };

export default async function MembersDirectoryPage({ searchParams }: { searchParams: Promise<PageParams> }) {
  const params = await searchParams;
  const activeTab = first(params.tab) === 'directory' ? 'directory' : 'map';
  const concentration = activeTab === 'map' ? await getPublicMemberConcentration() : null;
  const user = activeTab === 'directory' ? await getUser() : null;
  let listing: Awaited<ReturnType<typeof listMemberDirectory>> | null = null;
  let unavailable = false;

  if (activeTab === 'directory' && user) {
    try {
      listing = await listMemberDirectory(params);
    } catch (error) {
      // Authorization failures intentionally share one generic state: the browser learns neither
      // account state nor entitlement detail. Rate limits and transient failures are equally safe.
      if (error instanceof DirectoryRateLimitedError || error instanceof Error) unavailable = true;
    }
  }

  const pageHref = (page: number) => {
    const query = new URLSearchParams({ tab: 'directory', page: String(page) });
    for (const key of ['q', 'membershipType', 'country', 'federation', 'region', 'sort'] as const) {
      const value = first(params[key]);
      if (value) query.set(key, value);
    }
    return `?${query}`;
  };

  return <>
    <PageHeader eyebrow="Members" title="Members Directory" intro="Explore IDOC's worldwide member concentration. Active members may also search the privacy-minimized directory." />
    <section className="mx-auto max-w-7xl px-5 py-12 lg:px-8">
      <nav aria-label="Members directory views" className="flex gap-4 border-b border-border">
        <Link className={`pb-3 text-xs uppercase tracking-[0.14em] ${activeTab === 'map' ? 'border-b-2 border-gold text-foreground' : 'text-muted-foreground'}`} href="/about/members-directory">Map / Infographic</Link>
        <Link className={`pb-3 text-xs uppercase tracking-[0.14em] ${activeTab === 'directory' ? 'border-b-2 border-gold text-foreground' : 'text-muted-foreground'}`} href="/about/members-directory?tab=directory">Search Directory</Link>
      </nav>
      {activeTab === 'map' ? <div className="mt-8">
        {!concentration?.ok ? <p className="border border-border bg-surface/50 p-6 text-sm text-muted-foreground">The members map is temporarily unavailable. Please try again shortly.</p>
          : concentration.areas.length === 0 ? <p className="border border-border bg-surface/50 p-6 text-sm text-muted-foreground">Not enough member data is available yet to show the map. Check back soon.</p>
          : <ConcentrationMap areas={concentration.areas} />}
        <p className="mt-8 text-xs leading-relaxed text-muted-foreground">This infographic shows only privacy-thresholded country totals. It never exposes names, profiles, contact details, exact addresses, coordinates, identifiers, or small-group totals.</p>
      </div> : !user ? <div className="mt-8 border border-gold/40 bg-surface/50 p-6">
        <h2 className="font-semibold">Active membership required</h2>
        <p className="mt-2 text-sm text-muted-foreground">Directory results are available only to signed-in active members.</p>
        <Link className="mt-4 inline-block text-sm text-gold underline underline-offset-4" href="/sign-in">Member sign in</Link>
      </div> : unavailable ? <p className="mt-8 border border-border bg-surface/50 p-6 text-sm text-muted-foreground">The directory could not be loaded. Please try again later.</p> : <div>
        <form method="get" className="mt-6 grid gap-3 rounded-lg border p-4 md:grid-cols-4">
          <input name="tab" type="hidden" value="directory" />
          <label className="text-sm md:col-span-2">Name<input className="mt-1 block w-full rounded-md border p-2" defaultValue={first(params.q)} maxLength={100} name="q" type="search" /></label>
          <label className="text-sm">Membership type<select className="mt-1 block w-full rounded-md border p-2" defaultValue={first(params.membershipType) ?? ''} name="membershipType"><option value="">All</option>{MEMBERSHIP_TYPE_FILTERS.map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}</select></label>
          <label className="text-sm">Country<select className="mt-1 block w-full rounded-md border p-2" defaultValue={first(params.country) ?? ''} name="country"><option value="">All</option>{COUNTRY_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.name}</option>)}</select></label>
          <label className="text-sm">Federation<select className="mt-1 block w-full rounded-md border p-2" defaultValue={first(params.federation) ?? ''} name="federation"><option value="">All</option>{COUNTRY_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.name}</option>)}</select></label>
          <label className="text-sm">IDOC Region<select className="mt-1 block w-full rounded-md border p-2" defaultValue={first(params.region) ?? ''} name="region"><option value="">All</option>{IDOC_REGIONS.map((region) => <option key={region} value={region}>{region}</option>)}</select></label>
          <label className="text-sm">Sort<select className="mt-1 block w-full rounded-md border p-2" defaultValue={first(params.sort) ?? 'name'} name="sort"><option value="name">Name (A–Z)</option><option value="country">Country</option><option value="region">IDOC Region</option></select></label>
          <button className="self-end rounded-md border px-3 py-2 text-sm" type="submit">Apply filters</button>
        </form>
        {!listing || listing.rows.length === 0 ? <p className="mt-8 text-muted-foreground">No members match these filters.</p> : <>
          <p className="mt-6 text-sm text-muted-foreground">{listing.total} matching members</p>
          <div className="mt-2 overflow-x-auto"><table className="min-w-full border text-sm"><thead><tr>{['Name', 'Country', 'Role', 'Federation', 'Region'].map((label) => <th className="p-2 text-left" key={label}>{label}</th>)}</tr></thead><tbody>{listing.rows.map((row, index) => <tr className="border-t" key={index}><td className="p-2 font-medium">{row.firstName} {row.lastName}</td><td className="p-2">{countryNameForCode(row.country)}</td><td className="p-2">{row.roles?.length ? row.roles.map(roleLabel).join('; ') : '—'}</td><td className="p-2">{row.federation ? countryNameForCode(row.federation) : '—'}</td><td className="p-2">{row.region ?? '—'}</td></tr>)}</tbody></table></div>
          <nav aria-label="Pagination" className="mt-4 flex gap-3 text-sm">{listing.filters.page > 1 ? <Link className="underline" href={pageHref(listing.filters.page - 1)}>Previous</Link> : null}{listing.filters.page < listing.maxPage && listing.filters.page * listing.pageSize < listing.total ? <Link className="underline" href={pageHref(listing.filters.page + 1)}>Next</Link> : null}</nav>
        </>}
      </div>}
    </section>
  </>;
}
