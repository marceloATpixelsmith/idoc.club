import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { PageHeader } from '@/components/site/PageHeader';
import { MemberRegistrations, PublicSeminarsCatalog } from '@/components/seminars/member-registrations';
import { getPublicUser } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Seminars/Courses — IDOC',
  description:
    'Upcoming IDOC and FEI seminars, maintenance courses and transfer-up courses for dressage judges and stewards.',
  openGraph: {
    title: 'Seminars/Courses — IDOC',
    description: 'Maintenance courses, young horse seminars and para dressage transfer-up courses for officials.',
  },
};

export default async function SeminarsPage({ searchParams }: { searchParams: Promise<{ tab?: string; view?: string }> }) {
  const { tab, view } = await searchParams;
  const user = await getPublicUser();
  // Available Seminars is the default view; Past Seminars is a published archive for all
  // visitors, while My Seminars remains a member-only registration history.
  const showPastSeminars = view === 'past';
  const showMySeminars = Boolean(user) && view === 'my';

  return (
    <>
      <PageHeader
        action={(
          <a
            className="idoc-secondary-button idoc-secondary-button--dotted px-6 py-3 text-sm"
            href="https://data.fei.org/Calendar/OfficialCourseSearch.aspx"
            rel="noopener noreferrer"
            target="_blank"
          >
            FEI Course Calendar <ArrowUpRight className="size-4" />
          </a>
        )}
        eyebrow="Calendar"
        title="Seminars/Courses"
        intro="Education is at the heart of IDOC. Members receive priority information and registration details for every listed course."
      />
      <div className="mx-auto max-w-7xl px-5 pb-8 lg:px-8">
        {user ? (
          //ALIGN THE SECONDARY LEVEL WITH THE LEFT EDGE OF THE SEMINARS CONTENT AREA.
          <div className="mt-10 grid grid-cols-1 sm:grid-cols-[max-content_minmax(0,1fr)] sm:gap-x-9">
            <nav aria-label="Seminars/Courses view" className="grid grid-cols-1 gap-x-9 border-b border-border sm:col-span-2 sm:grid-cols-subgrid">
              <Link
                aria-current={!showMySeminars ? 'page' : undefined}
                href="/seminars"
                className={`w-fit border-b-[3px] pb-4 pt-1 text-sm font-semibold uppercase tracking-[0.11em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold ${showMySeminars ? 'border-transparent text-muted-foreground hover:text-foreground' : 'border-gold text-foreground'}`}
              >
                Available Seminars/Courses
              </Link>
              <Link
                aria-current={showMySeminars ? 'page' : undefined}
                href="/seminars?view=my"
                className={`w-fit border-b-[3px] pb-4 pt-1 text-sm font-semibold uppercase tracking-[0.11em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold ${showMySeminars ? 'border-gold text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
              >
                My Seminars/Courses
              </Link>
              <Link
                aria-current={showPastSeminars ? 'page' : undefined}
                href="/seminars?view=past"
                className={`w-fit border-b-[3px] pb-4 pt-1 text-sm font-semibold uppercase tracking-[0.11em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold ${showPastSeminars ? 'border-gold text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
              >
                Past Seminars/Courses
              </Link>
            </nav>
            {showMySeminars ? (
              <nav aria-label="Registration history" className="bg-surface/45 pb-3 pt-4 sm:col-span-2">
                <div className="flex flex-wrap items-center gap-x-7 gap-y-2">
                  <Link
                    aria-current={tab !== 'past' ? 'page' : undefined}
                    className={`border-b-2 pb-1.5 text-sm tracking-[0.025em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold ${tab === 'past' ? 'border-transparent text-muted-foreground hover:text-foreground' : 'border-gold font-medium text-foreground'}`}
                    href="/seminars?view=my"
                  >Upcoming &amp; current</Link>
                  <Link
                    aria-current={tab === 'past' ? 'page' : undefined}
                    className={`border-b-2 pb-1.5 text-sm tracking-[0.025em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold ${tab === 'past' ? 'border-gold font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                    href="/seminars?view=my&tab=past"
                  >Past</Link>
                </div>
              </nav>
            ) : null}
          </div>
        ) : null}
        {showMySeminars ? (
          <MemberRegistrations tab={tab} view="my" />
        ) : showPastSeminars ? (
          <MemberRegistrations view="past" />
        ) : user ? (
          <MemberRegistrations view="available" />
        ) : (
          <PublicSeminarsCatalog />
        )}
      </div>
    </>
  );
}
