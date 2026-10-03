import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/site/PageHeader';
import { listPublicArticles } from '@/lib/news/articles';

export const metadata: Metadata = {
  title: 'IDOC News — Dressage Officials Updates',
  description:
    'Announcements, tributes, rule revisions and education updates from the International Dressage Officials Club.',
  openGraph: {
    title: 'IDOC News — Dressage Officials Updates',
    description: 'Announcements, rule revisions and education updates from IDOC.',
  },
};

export default async function NewsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page: pageParam } = await searchParams;
  const { rows, page, hasNext } = await listPublicArticles(pageParam, 'news');
  return (
    <>
      <PageHeader eyebrow="Newsroom" title="IDOC News" intro="Announcements, tributes and education updates for judges, stewards and veterinarians." />
      <div className="mx-auto max-w-7xl px-5 pb-8 pt-10 lg:px-8 lg:pt-12">
        {rows.length === 0 ? (
          <p className="py-10 text-muted-foreground">No news articles have been published yet. Check back soon.</p>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {rows.map((item) => {
              const external = Boolean(item.external_url);
              const href = external ? String(item.external_url) : `/news/${item.slug}`;
              const linkProps = external ? { rel: 'noopener noreferrer', target: '_blank' as const } : {};
              return (
                <li className="py-10" key={String(item.slug)}>
                  {item.thumbnail_url ? (
                    <Link className="block" href={href} {...linkProps}>
                      <img alt="" className="aspect-[16/9] w-full rounded-lg object-cover" loading="lazy" src={String(item.thumbnail_url)} />
                    </Link>
                  ) : null}
                  <div className={item.thumbnail_url ? 'mt-6' : ''}>
                    <p className="text-xs uppercase tracking-[0.18em] text-gold">
                      {new Date(String(item.publication_date)).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}
                    </p>
                    <h2 className="mt-4 text-3xl leading-snug">
                      <Link className="hover:underline" href={href} {...linkProps}>{String(item.title)}</Link>
                    </h2>
                    {item.subtitle ? <p className="mt-4 leading-relaxed text-muted-foreground">{String(item.subtitle)}</p> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <nav className="flex gap-4 pt-6">
          {page > 1 ? <Link href={`/news?page=${page - 1}`}>← Previous</Link> : null}
          {hasNext ? <Link href={`/news?page=${page + 1}`}>Next →</Link> : null}
        </nav>
      </div>
    </>
  );
}
