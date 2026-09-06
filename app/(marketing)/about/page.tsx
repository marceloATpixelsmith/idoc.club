import type { Metadata } from 'next';
import { FileText } from 'lucide-react';
import { PageHeader } from '@/components/site/PageHeader';
import { aboutDocuments, aboutGoals, aboutHonoraryMembers, aboutMilestones } from '@/lib/content/site';

export const metadata: Metadata = {
  title: 'About IDOC — Purpose, Goals & Documents',
  description:
    'IDOC is a Belgian non-profit founded in 1990: an independent club of dressage judges, stewards and veterinarians promoting horsemanship and the education of officials.',
  openGraph: {
    title: 'About IDOC — Purpose, Goals & Documents',
    description:
      'An independent club of dressage officials promoting horsemanship and education worldwide.',
  },
};

export default function AboutPage() {
  return (
    <>
      <PageHeader
        eyebrow="What is IDOC"
        title="A club of officials, for officials"
        intro="The International Dressage Officials Club (IDOC) is a Belgian non-profit organization created in 1990, originally as the IDJC — International Dressage Judges Club. It exists to promote the principles of horsemanship, to further the education of officials, and to give judges, stewards and veterinarians a shared, independent voice within the sport."
      />

      <section className="mx-auto grid max-w-7xl gap-12 px-5 py-20 lg:grid-cols-3 lg:px-8">
        {[
          {
            t: 'Horsemanship first',
            d: 'Every position IDOC takes starts from the welfare of the horse and the classical principles of training.',
          },
          {
            t: 'Education',
            d: 'Seminars, maintenance courses and shared judging guidance keep officials aligned across continents.',
          },
          {
            t: 'Independent voice',
            d: 'IDOC represents officials in dialogue with the FEI, national federations and the wider dressage community.',
          },
        ].map((c) => (
          <div key={c.t}>
            <h2 className="rule-gold text-2xl">{c.t}</h2>
            <p className="mt-6 text-sm leading-relaxed text-muted-foreground">{c.d}</p>
          </div>
        ))}
      </section>

      <section className="border-y border-border bg-surface/50">
        <div className="mx-auto max-w-7xl px-5 py-20 lg:px-8">
          <p className="eyebrow">Our purpose</p>
          <h2 className="mt-3 text-4xl">IDOC Goals</h2>
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            The main goals of the International Dressage Officials Club are the
            following:
          </p>
          <ol className="mt-10 grid gap-6 lg:grid-cols-2">
            {aboutGoals.map((g, i) => (
              <li key={g} className="flex gap-5 border border-border p-6">
                <span className="font-display text-2xl text-gold">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <p className="text-sm leading-relaxed text-muted-foreground">{g}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-20 lg:px-8">
        <p className="eyebrow">History</p>
        <h2 className="mt-3 text-4xl">Statutes &amp; milestones</h2>
        <p className="mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          IDOC is a Belgian non-profit organization with its seat in Antwerp (Belgium).
          Its statutes were originally published in 1990 and revised in 2009.
        </p>
        <ul className="mt-10 divide-y divide-border border-y border-border">
          {aboutMilestones.map((m) => (
            <li key={m.date} className="grid gap-3 py-6 sm:grid-cols-[14rem_1fr]">
              <p className="text-[0.72rem] uppercase tracking-[0.16em] text-gold">
                {m.date}
              </p>
              <p className="text-sm leading-relaxed text-muted-foreground">{m.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-t border-border bg-surface/40">
        <div className="mx-auto grid max-w-7xl gap-6 px-5 py-20 lg:grid-cols-2 lg:px-8">
          <div className="card-midnight p-8">
            <h2 className="text-2xl">IDOC Documents</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Statutes and Internal Regulations, freely available.
            </p>
            <ul className="mt-7 space-y-3">
              {aboutDocuments.map((d) => (
                <li key={d.href}>
                  <a
                    href={d.href}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-start gap-3 border border-border px-4 py-3 text-sm text-muted-foreground transition-colors hover:border-gold/60 hover:text-foreground"
                  >
                    <FileText className="mt-0.5 size-4 shrink-0 text-gold" />
                    {d.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div className="card-midnight p-8">
            <h2 className="text-2xl">Honorary Members</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              IDOC is proud to count the following dressage personalities among its
              Honorary Members.
            </p>
            <ul className="mt-7 divide-y divide-border border-y border-border">
              {aboutHonoraryMembers.map((h) => (
                <li key={h} className="py-3 font-display text-xl">
                  {h}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </>
  );
}
