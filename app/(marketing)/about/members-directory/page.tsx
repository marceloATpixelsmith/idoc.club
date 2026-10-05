import type { Metadata } from 'next';
import Link from 'next/link';
import { ConcentrationMap } from '@/components/directory/concentration-map';
import { MemberDirectoryTable } from '@/components/directory/member-directory-table';
import { PageHeader } from '@/components/site/PageHeader';
import { getPublicUser } from '@/lib/db/queries';
import { getPublicMemberConcentration } from '@/lib/directory/aggregate';
import {
  DirectoryRateLimitedError,
  listMemberDirectory,
  type MemberDirectoryFilters,
} from '@/lib/directory/member-directory';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'IDOC Members Directory — Officials Worldwide',
  description: 'A privacy-first map and member-only directory of IDOC officials worldwide.',
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? undefined : value;
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
      if (error instanceof DirectoryRateLimitedError || error instanceof Error) unavailable = true;
    }
  }

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
      </div> : unavailable || !listing ? <p className="mt-8 border border-border bg-surface/50 p-6 text-sm text-muted-foreground">The directory could not be loaded. Please try again later.</p> : <MemberDirectoryTable filters={listing.filters} pageSize={listing.pageSize} rows={listing.rows} total={listing.total} />}
    </section>
  </>;
}
