import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { PageHeader } from '@/components/site/PageHeader';
import { MemberRegistrations, PublicSeminarsCatalog } from '@/components/seminars/member-registrations';
import { getPublicUser } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Seminars & Courses — IDOC',
  description:
    'Upcoming IDOC and FEI seminars, maintenance courses and transfer-up courses for dressage judges and stewards.',
  openGraph: {
    title: 'Seminars & Courses — IDOC',
    description: 'Maintenance courses, young horse seminars and para dressage transfer-up courses for officials.',
  },
};

export default async function SeminarsPage({ searchParams }: { searchParams: Promise<{ tab?: string; view?: string }> }) {
  const { tab, view } = await searchParams;
  const user = await getPublicUser();
  // Available Seminars (the full published catalog) is always the landing view, whether or not a
  // visitor is signed in. "My Seminars" is an explicit second tab, reachable only by a logged-in
  // member -- a signed-out visitor sees no tabs at all, just the catalog.
  const showMySeminars = Boolean(user) && view === 'my';

  return (
    <>
      <PageHeader
        action={(
          <a
            className="inline-flex items-center gap-2 rounded-full border border-dotted border-gold/70 bg-accent px-6 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-foreground transition-colors hover:bg-surface-raised"
            href="https://data.fei.org/Calendar/OfficialCourseSearch.aspx"
            rel="noopener noreferrer"
            target="_blank"
          >
            FEI Course Calendar <ArrowUpRight className="size-4 text-gold" />
          </a>
        )}
        eyebrow="Calendar"
        title="Seminars & Courses"
        intro="Education is at the heart of IDOC. Members receive priority information and registration details for every listed course."
      />
      <div className="mx-auto max-w-7xl px-5 pb-8 lg:px-8">
        {user ? (
          <nav aria-label="Seminars view" className="mt-10 flex gap-4 border-b border-border">
            <Link
              href="/seminars"
              className={`pb-2 text-xs uppercase tracking-[0.14em] ${showMySeminars ? 'text-muted-foreground' : 'border-b-2 border-gold'}`}
            >
              Available Seminars
            </Link>
            <Link
              href="/seminars?view=my"
              className={`pb-2 text-xs uppercase tracking-[0.14em] ${showMySeminars ? 'border-b-2 border-gold' : 'text-muted-foreground'}`}
            >
              My Seminars
            </Link>
          </nav>
        ) : null}
        {user ? (
          <MemberRegistrations tab={tab} view={showMySeminars ? 'my' : 'available'} />
        ) : (
          <PublicSeminarsCatalog />
        )}
      </div>
    </>
  );
}
