import type { Metadata } from 'next';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { PageHeader } from '@/components/site/PageHeader';

export const metadata: Metadata = {
  title: 'Become a Member — IDOC',
  description:
    'Membership of the International Dressage Officials Club for judges, stewards and veterinarians: benefits, categories and how to join.',
  openGraph: {
    title: 'Become a Member — IDOC',
    description: "Join IDOC: seminars, documents, General Assembly papers and the officials' directory.",
  },
};

const perks = [
  'Member area access',
  'Seminar priority information',
  'IDOC documents & GA papers',
  "Officials' directory",
];

const tiers = [
  { name: 'Judges', for: 'FEI and national dressage judges', param: 'judge' },
  { name: 'Judge & Steward', for: 'Combined membership for judges who also steward', param: 'judge_steward' },
  { name: 'Stewards', for: 'FEI and national dressage stewards', param: 'steward' },
  { name: 'Veterinarians', for: 'FEI and national dressage veterinarians', param: 'veterinarian' },
];

export default function MembershipPage() {
  return (
    <>
      <PageHeader
        eyebrow="Membership"
        title="Become a Member"
        intro="Membership is open to dressage judges, stewards and veterinarians at national and international level. Annual dues are €80 per year and fund education, seminars and the club's representation work."
      />

      <section className="mx-auto grid max-w-7xl gap-6 px-5 py-20 sm:grid-cols-2 lg:grid-cols-4 lg:px-8">
        {tiers.map((t) => (
          <div key={t.name} className="card-midnight flex flex-col p-8">
            <h2 className="text-3xl">{t.name}</h2>
            <p className="mt-2 text-sm uppercase tracking-[0.16em] text-gold">€80 / year</p>
            <p className="mt-5 text-sm leading-relaxed text-muted-foreground">{t.for}</p>
            <ul className="mt-7 flex-1 space-y-3 text-sm">
              {perks.map((p) => (
                <li key={p} className="flex items-start gap-3 text-muted-foreground">
                  <Check className="mt-0.5 size-4 shrink-0 text-gold" /> {p}
                </li>
              ))}
            </ul>
            <Link
              href={`/sign-up?membership=${t.param}`}
              className="mt-8 border border-gold/60 px-6 py-3 text-center text-xs font-semibold uppercase tracking-[0.18em] text-gold transition-colors hover:bg-gold hover:text-primary-foreground"
            >
              Apply
            </Link>
          </div>
        ))}
      </section>
    </>
  );
}
