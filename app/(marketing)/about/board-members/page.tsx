import type { Metadata } from 'next';
import { PageHeader } from '@/components/site/PageHeader';
import { boardMembers } from '@/lib/content/site';

export const metadata: Metadata = {
  title: 'IDOC Board Members — Officers & Regional Representatives',
  description:
    "Meet the IDOC board: president, vice-presidents, secretary, treasurer, regional representatives, steward and para dressage representatives.",
  openGraph: {
    title: 'IDOC Board Members',
    description:
      'The officers and regional representatives of the International Dressage Officials Club.',
  },
};

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="currentColor">
      <path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z" />
    </svg>
  );
}

export default function BoardMembersPage() {
  return (
    <>
      <PageHeader
        eyebrow="Governance"
        title="Board Members"
        intro="The IDOC board brings together judges, stewards and para dressage officials from every region of the sport."
      />

      <section className="mx-auto max-w-7xl px-5 py-20 lg:px-8">
        <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {boardMembers.map((m) => (
            <article key={m.name} className="card-midnight overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element -- portrait grid, plain img matches the rest of the site */}
              <img
                src={m.photo}
                alt={`Portrait of ${m.name}`}
                loading="lazy"
                className="aspect-[4/5] w-full object-cover object-top"
              />
              <div className="p-6">
                <p className="text-[0.68rem] uppercase tracking-[0.18em] text-gold">
                  {m.role}
                </p>
                <h2 className="mt-3 font-display text-2xl leading-snug">
                  {m.name} <span className="text-muted-foreground">({m.country})</span>
                </h2>
                {m.detail.length > 0 && (
                  <ul className="mt-4 space-y-1 text-sm text-muted-foreground">
                    {m.detail.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                )}
                {m.fb && (
                  <a
                    href={m.fb}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${m.name} on Facebook`}
                    className="mt-5 inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:border-gold/50 hover:text-gold"
                  >
                    <FacebookIcon />
                    Facebook
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
