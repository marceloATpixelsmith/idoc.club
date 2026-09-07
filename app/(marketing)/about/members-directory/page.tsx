import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/site/PageHeader';
import { ConcentrationMap } from '@/components/directory/concentration-map';
import { getPublicMemberConcentration } from '@/lib/directory/aggregate';

export const metadata: Metadata = {
  title: 'IDOC Members Directory — Officials Worldwide',
  description:
    'An interactive map of where IDOC dressage judges, stewards and veterinarians are based worldwide, aggregated by country to protect member privacy.',
  openGraph: {
    title: 'IDOC Members Directory',
    description: 'Member concentration by country for the International Dressage Officials Club.',
  },
};

export default async function MembersDirectoryPage() {
  const result = await getPublicMemberConcentration();

  return (
    <>
      <PageHeader
        eyebrow="Members"
        title="Members Directory"
        intro="Where IDOC officials — judges, stewards and veterinarians — are based worldwide, shown by country to protect individual members' privacy."
      />

      <section className="mx-auto max-w-7xl px-5 py-20 lg:px-8">
        {!result.ok ? (
          <p className="border border-border bg-surface/50 p-6 text-sm leading-relaxed text-muted-foreground">
            The members map is temporarily unavailable. Please try again shortly.
          </p>
        ) : result.areas.length === 0 ? (
          <p className="border border-border bg-surface/50 p-6 text-sm leading-relaxed text-muted-foreground">
            Not enough member data is available yet to show the map. Check back soon.
          </p>
        ) : (
          <ConcentrationMap areas={result.areas} />
        )}

        <p className="mt-10 text-xs leading-relaxed text-muted-foreground">
          To protect individual members, this map never shows names, exact addresses, exact
          coordinates, or any other identifying detail — only a country&rsquo;s total member count,
          and only once that country has at least {result.ok ? result.threshold : 'a minimum number of'} current
          members.
        </p>

        <div className="mt-10 flex items-start gap-4 border border-gold/40 bg-surface/50 p-6">
          <p className="text-sm leading-relaxed text-muted-foreground">
            IDOC members can search the full directory — filterable by membership type, federation,
            country and region — from{' '}
            <Link className="text-gold underline underline-offset-4" href="/dashboard/directory">
              their member dashboard
            </Link>
            . <Link className="text-gold underline underline-offset-4" href="/sign-in">Sign in</Link> to
            use it.
          </p>
        </div>
      </section>
    </>
  );
}
