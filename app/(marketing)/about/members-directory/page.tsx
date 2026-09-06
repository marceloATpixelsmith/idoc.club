import type { Metadata } from 'next';
import { Lock } from 'lucide-react';
import { PageHeader } from '@/components/site/PageHeader';
import { membersDirectoryPlaceholder } from '@/lib/content/site';

export const metadata: Metadata = {
  title: 'IDOC Members Directory — Officials Worldwide',
  description:
    'A directory of IDOC members: dressage judges, stewards and veterinarians, their country, official level and role.',
  openGraph: {
    title: 'IDOC Members Directory',
    description: 'Placeholder directory of IDOC judges, stewards and veterinarians worldwide.',
  },
};

export default function MembersDirectoryPage() {
  return (
    <>
      <PageHeader
        eyebrow="Members"
        title="Members Directory"
        intro="A searchable directory of IDOC officials — judges, stewards and veterinarians — with country, discipline level and contact details."
      />

      <section className="mx-auto max-w-7xl px-5 py-20 lg:px-8">
        <div className="flex items-start gap-4 border border-gold/40 bg-surface/50 p-6">
          <Lock className="mt-0.5 size-5 shrink-0 text-gold" />
          <p className="text-sm leading-relaxed text-muted-foreground">
            Placeholder content. The entries below are examples only — the real directory
            will be populated from IDOC membership records and will later be visible to
            signed-in members only.
          </p>
        </div>

        <div className="mt-10 overflow-x-auto border border-border">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-surface/50 text-[0.68rem] uppercase tracking-[0.16em] text-muted-foreground">
                <th className="px-6 py-4 font-medium">Name</th>
                <th className="px-6 py-4 font-medium">Country</th>
                <th className="px-6 py-4 font-medium">Role</th>
                <th className="px-6 py-4 font-medium">Level</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {membersDirectoryPlaceholder.map((m) => (
                <tr key={m.name}>
                  <td className="px-6 py-4 font-display text-lg">{m.name}</td>
                  <td className="px-6 py-4 text-muted-foreground">{m.country}</td>
                  <td className="px-6 py-4 text-gold">{m.role}</td>
                  <td className="px-6 py-4 text-muted-foreground">{m.level}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
