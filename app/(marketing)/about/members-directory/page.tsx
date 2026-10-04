import type { Metadata } from 'next';
import Link from 'next/link';
import { Mail } from 'lucide-react';
import { ConcentrationMap } from '@/components/directory/concentration-map';
import { PageHeader } from '@/components/site/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getPublicUser } from '@/lib/db/queries';
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
  const user = await getPublicUser();
  const activeTab = user && first(params.tab) === 'directory' ? 'directory' : 'map';
  const concentration = activeTab === 'map' ? await getPublicMemberConcentration() : null;
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
    for (const key of ['q', 'membershipType', 'federation', 'region', 'sort'] as const) {
      const value = first(params[key]);
      if (value) query.set(key, value);
    }
    return `?${query}`;
  };
  const filterHref = (remove?: string) => {
    const query = new URLSearchParams({ tab: 'directory' });
    for (const key of ['q', 'membershipType', 'federation', 'region', 'sort'] as const) {
      const value = key === remove ? undefined : first(params[key]);
      if (value) query.set(key, value);
    }
    return `?${query}`;
  };

  return <>
    <PageHeader eyebrow="Members" title="Members Directory" intro="Explore IDOC's worldwide member concentration. Active members can search and contact other members in the directory." />
    <section className="mx-auto max-w-7xl px-5 py-12 lg:px-8">
      {user ? <nav aria-label="Members directory views" className="flex gap-4 border-b border-border">
        <Link className={`pb-3 text-xs uppercase tracking-[0.14em] ${activeTab === 'map' ? 'border-b-2 border-gold text-foreground' : 'text-muted-foreground'}`} href="/about/members-directory">Map / Infographic</Link>
        <Link className={`pb-3 text-xs uppercase tracking-[0.14em] ${activeTab === 'directory' ? 'border-b-2 border-gold text-foreground' : 'text-muted-foreground'}`} href="/about/members-directory?tab=directory">Search Directory</Link>
      </nav> : null}
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
        <form method="get" className="mt-6 flex flex-wrap items-end gap-2 rounded-xl border bg-background p-3">
          <input name="tab" type="hidden" value="directory" />
          <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm">Search members<Input className="h-9" defaultValue={first(params.q)} maxLength={100} name="q" placeholder="Name or email…" type="search" /></label>
          <label className="flex flex-col gap-1 text-sm">Membership type<select className="h-9 rounded-md border bg-background px-2 text-sm" defaultValue={first(params.membershipType) ?? ''} name="membershipType"><option value="">All types</option>{MEMBERSHIP_TYPE_FILTERS.map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}</select></label>
          <label className="flex flex-col gap-1 text-sm">Federation<select className="h-9 rounded-md border bg-background px-2 text-sm" defaultValue={first(params.federation) ?? ''} name="federation"><option value="">All federations</option>{COUNTRY_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.name}</option>)}</select></label>
          <label className="flex flex-col gap-1 text-sm">IDOC Region<select className="h-9 rounded-md border bg-background px-2 text-sm" defaultValue={first(params.region) ?? ''} name="region"><option value="">All regions</option>{IDOC_REGIONS.map((region) => <option key={region} value={region}>{region}</option>)}</select></label>
          <label className="flex flex-col gap-1 text-sm">Sort<select className="h-9 rounded-md border bg-background px-2 text-sm" defaultValue={first(params.sort) ?? 'name'} name="sort"><option value="name">Name (A–Z)</option><option value="country">Country</option><option value="region">IDOC Region</option></select></label>
          <Button type="submit">Search</Button>
          <Button asChild variant="outline"><Link href="/about/members-directory?tab=directory">Reset</Link></Button>
        </form>
        {['q', 'membershipType', 'federation', 'region'].some((key) => Boolean(first(params[key as 'q' | 'membershipType' | 'federation' | 'region']))) && <div aria-label="Active filters" className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Active filters:</span>
          {([
            ['q', 'Search'], ['membershipType', 'Membership type'], ['federation', 'Federation'], ['region', 'IDOC Region'],
          ] as const).map(([key, label]) => {
            const value = first(params[key]);
            return value ? <span className="rounded-full border bg-muted px-3 py-1 text-xs" key={key}>{label}: {key === 'membershipType' ? TYPE_LABELS[value] ?? value : key === 'federation' ? countryNameForCode(value) : value}<Link aria-label={`Remove ${label} filter`} className="ml-1" href={filterHref(key)}>×</Link></span> : null;
          })}
        </div>}
        {!listing || listing.rows.length === 0 ? <p className="mt-8 text-muted-foreground">No members match these filters.</p> : <>
          <p className="mt-5 px-1 text-sm text-muted-foreground">{listing.total} matching members</p>
          <div className="relative mt-2 overflow-hidden rounded-md border"><Table><TableHeader><TableRow>{['Name', 'Email', 'Country', 'Role', 'Federation', 'Region', 'Actions'].map((label) => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{listing.rows.map((row, index) => <TableRow key={index}><TableCell className="font-medium">{row.firstName} {row.lastName}</TableCell><TableCell><a className="text-primary underline underline-offset-4" href={`mailto:${row.email}`}>{row.email}</a></TableCell><TableCell>{countryNameForCode(row.country)}</TableCell><TableCell>{row.roles?.length ? row.roles.map(roleLabel).join('; ') : '—'}</TableCell><TableCell>{row.federation ? countryNameForCode(row.federation) : '—'}</TableCell><TableCell>{row.region ?? '—'}</TableCell><TableCell><Button asChild size="sm" variant="outline"><a aria-label={`Email ${row.firstName} ${row.lastName}`} href={`mailto:${row.email}`}><Mail /> Email</a></Button></TableCell></TableRow>)}</TableBody></Table></div>
          <nav aria-label="Pagination" className="mt-3 flex items-center justify-between gap-3 p-1 text-sm"><span className="text-muted-foreground">Page {listing.filters.page} of {Math.max(1, Math.min(listing.maxPage, Math.ceil(listing.total / listing.pageSize)))}</span><div className="flex gap-2">{listing.filters.page > 1 ? <Button asChild size="sm" variant="outline"><Link href={pageHref(listing.filters.page - 1)}>Previous</Link></Button> : null}{listing.filters.page < listing.maxPage && listing.filters.page * listing.pageSize < listing.total ? <Button asChild size="sm" variant="outline"><Link href={pageHref(listing.filters.page + 1)}>Next</Link></Button> : null}</div></nav>
        </>}
      </div>}
    </section>
  </>;
}
