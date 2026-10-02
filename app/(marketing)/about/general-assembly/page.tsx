import type { Metadata } from 'next';
import { FileText } from 'lucide-react';
import { PageHeader } from '@/components/site/PageHeader';
import { generalAssemblyEditions } from '@/lib/content/site';

export const metadata: Metadata = {
  title: 'IDOC General Assembly — Programmes & Documents',
  description:
    'Agendas, final programmes, annual reports and proxy forms from IDOC General Assemblies and FEI refresher seminars for judges and stewards.',
  openGraph: {
    title: 'IDOC General Assembly',
    description:
      'Agendas, programmes and reports from IDOC General Assemblies and FEI refresher seminars.',
  },
};

export default function GeneralAssemblyPage() {
  return (
    <>
      <PageHeader
        eyebrow="General Assembly"
        title="General Assembly & FEI refresher seminars for judges"
        intro="Agendas, final programmes, annual reports and proxy forms from past and upcoming IDOC General Assemblies."
      />

      <section className="mx-auto max-w-7xl px-5 py-20 lg:px-8">
        <ul className="space-y-6">
          {generalAssemblyEditions.map((e) => (
            <li key={`${e.place}-${e.dates}`} className="card-midnight p-8">
              <p className="text-[0.68rem] uppercase tracking-[0.18em] text-gold">
                {e.place}
              </p>
              <h2 className="mt-3 font-display text-2xl">{e.dates}</h2>
              {e.note && (
                <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                  {e.note}
                </p>
              )}
              <ul className="mt-6 space-y-3">
                {e.docs.map((d) => (
                  <li key={d.label}>
                    {d.href ? (
                      <a
                        href={d.href}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-start gap-3 border border-border px-4 py-3 text-sm text-muted-foreground transition-colors hover:border-gold/60 hover:text-foreground"
                      >
                        <FileText className="mt-0.5 size-4 shrink-0 text-gold" />
                        {d.label}
                      </a>
                    ) : (
                      <span className="flex items-start gap-3 border border-border px-4 py-3 text-sm text-muted-foreground">
                        <FileText className="mt-0.5 size-4 shrink-0 text-gold/50" />
                        {d.label} — available on request
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
