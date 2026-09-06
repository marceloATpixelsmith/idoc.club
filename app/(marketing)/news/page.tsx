import type { Metadata } from 'next';
import { news } from '@/lib/content/site';
import { PageHeader } from '@/components/site/PageHeader';

export const metadata: Metadata = {
  title: 'IDOC News — Dressage Officials Updates',
  description:
    'Announcements, tributes, rule revisions and education updates from the International Dressage Officials Club.',
  openGraph: {
    title: 'IDOC News — Dressage Officials Updates',
    description: 'Announcements, rule revisions and education updates from IDOC.',
  },
};

export default function NewsPage() {
  return (
    <>
      <PageHeader eyebrow="Newsroom" title="IDOC News" intro="Announcements, tributes and education updates for judges, stewards and veterinarians." />
      <div className="mx-auto max-w-7xl px-5 pb-8 lg:px-8">
        <ul className="divide-y divide-border border-t border-border">
          {news.map((item) => (
            <li key={item.slug} className="py-10">
              <div className="flex items-center gap-3 text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">
                <span className="text-gold">{item.category}</span>
                <span className="h-px w-6 bg-border" />
                <span>{item.date}</span>
              </div>
              <h2 className="mt-4 text-3xl leading-snug">{item.title}</h2>
              <p className="mt-4 leading-relaxed text-muted-foreground">{item.excerpt}</p>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
