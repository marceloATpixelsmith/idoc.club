import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarDays, MapPin } from 'lucide-react';
import { seminars } from '@/lib/content/site';
import { PageHeader } from '@/components/site/PageHeader';
import { MemberRegistrations } from '@/components/seminars/member-registrations';
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
  // Logged-in members land on "My Seminars" by default; "Available Seminars" is the explicit
  // second tab. A non-member always sees the available list, with no tabs at all.
  const showMySeminars = Boolean(user) && view !== 'available';

  return (
    <>
      <PageHeader
        eyebrow="Calendar"
        title="Seminars & Courses"
        intro="Education is at the heart of IDOC. Members receive priority information and registration details for every listed course."
      />
      <div className="mx-auto max-w-7xl px-5 pb-8 lg:px-8">
        {user ? (
          <nav aria-label="Seminars view" className="mt-10 flex gap-4 border-b border-border">
            <Link
              href="/seminars?view=available"
              className={`pb-2 text-xs uppercase tracking-[0.14em] ${showMySeminars ? 'text-muted-foreground' : 'border-b-2 border-gold'}`}
            >
              Available Seminars
            </Link>
            <Link
              href="/seminars"
              className={`pb-2 text-xs uppercase tracking-[0.14em] ${showMySeminars ? 'border-b-2 border-gold' : 'text-muted-foreground'}`}
            >
              My Seminars
            </Link>
          </nav>
        ) : null}
        {showMySeminars ? (
          <MemberRegistrations tab={tab} />
        ) : (
          <ul className="grid gap-6 py-12 sm:grid-cols-2">
            {seminars.map((s) => (
              <li key={s.title} className="card-midnight p-7">
                <span className="text-[0.68rem] uppercase tracking-[0.18em] text-gold">
                  {s.audience}
                </span>
                <h2 className="mt-3 text-2xl leading-snug">{s.title}</h2>
                <div className="mt-5 space-y-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  <p className="inline-flex items-center gap-2">
                    <MapPin className="size-3.5 text-gold" /> {s.location}
                  </p>
                  <p className="inline-flex items-center gap-2">
                    <CalendarDays className="size-3.5 text-gold" /> {s.date}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
