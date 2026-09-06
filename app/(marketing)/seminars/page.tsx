import type { Metadata } from 'next';
import { CalendarDays, MapPin } from 'lucide-react';
import { seminars } from '@/lib/content/site';
import { PageHeader } from '@/components/site/PageHeader';

export const metadata: Metadata = {
  title: 'Seminars & Courses — IDOC',
  description:
    'Upcoming IDOC and FEI seminars, maintenance courses and transfer-up courses for dressage judges and stewards.',
  openGraph: {
    title: 'Seminars & Courses — IDOC',
    description: 'Maintenance courses, young horse seminars and para dressage transfer-up courses for officials.',
  },
};

export default function SeminarsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Calendar"
        title="Seminars & Courses"
        intro="Education is at the heart of IDOC. Members receive priority information and registration details for every listed course."
      />
      <div className="mx-auto max-w-7xl px-5 pb-8 lg:px-8">
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
        <a
          href="https://inside.fei.org/fei/edu/officials/dressage"
          target="_blank"
          rel="noreferrer"
          className="inline-flex border border-gold/60 px-6 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-gold transition-colors hover:bg-gold hover:text-primary-foreground"
        >
          FEI Course Calendar
        </a>
      </div>
    </>
  );
}
