import type { Metadata } from 'next';
import { PageHeader } from '@/components/site/PageHeader';
import { PublicNewsCard } from '@/components/news/public-news-card';
import { listAllPublicArticles } from '@/lib/news/articles';

export const metadata: Metadata = {
  title: 'IDOC News — Dressage Officials Updates',
  description:
    'Announcements, tributes, rule revisions and education updates from the International Dressage Officials Club.',
  openGraph: {
    title: 'IDOC News — Dressage Officials Updates',
    description: 'Announcements, rule revisions and education updates from IDOC.',
  },
};

export default async function NewsPage() {
  const rows = await listAllPublicArticles('news');
  return (
    <>
      <PageHeader eyebrow="Newsroom" title="IDOC News" intro="Announcements, tributes and education updates for judges, stewards and veterinarians." />
      <div className="mx-auto max-w-7xl px-5 pb-12 pt-10 lg:px-8 lg:pt-12">
        {rows.length === 0 ? (
          <p className="py-10 text-muted-foreground">No news articles have been published yet. Check back soon.</p>
        ) : (
          <div className="flex max-w-xl flex-col gap-6">
            {rows.map((item) => <PublicNewsCard item={item as never} key={String(item.slug)} />)}
          </div>
        )}
      </div>
    </>
  );
}
