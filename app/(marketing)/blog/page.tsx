import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/site/PageHeader';
import { listPublicArticles } from '@/lib/news/articles';

export const metadata: Metadata = {
  title: "President's Blog — IDOC",
  description: "Articles from the IDOC President on judging standards, welfare, data and the evolving role of the dressage official.",
};

export default async function BlogPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page: pageParam } = await searchParams;
  const { rows, page, hasNext } = await listPublicArticles(pageParam, 'blog');
  return (
    <>
      <PageHeader eyebrow="From the Director" title="President's Blog" intro="Reflections on judging standards, horse welfare, data and integrity from IDOC leadership." />
      <div className="mx-auto max-w-7xl px-5 pb-8 lg:px-8">
        <div className="mb-10"><NewsTypeSwitch active="blog" /></div>
        {rows.length === 0 ? (
          <p className="py-10 text-muted-foreground">No blog articles have been published yet. Check back soon.</p>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {rows.map((item) => (
              <li className="py-10" key={String(item.slug)}>
                {item.thumbnail_url ? (
                  <Link className="block" href={`/blog/${item.slug}`}>
                    <img alt="" className="aspect-[16/9] w-full rounded-lg object-cover" loading="lazy" src={String(item.thumbnail_url)} />
                  </Link>
                ) : null}
                <div className={item.thumbnail_url ? 'mt-6' : ''}>
                  <p className="text-xs uppercase tracking-[0.18em] text-gold">
                    {new Date(String(item.publication_date)).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                  <h2 className="mt-4 text-3xl leading-snug"><Link className="hover:underline" href={`/blog/${item.slug}`}>{String(item.title)}</Link></h2>
                  {item.subtitle ? <p className="mt-4 leading-relaxed text-muted-foreground">{String(item.subtitle)}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        <nav className="flex gap-4 pt-6">
          {page > 1 ? <Link href={`/blog?page=${page - 1}`}>← Previous</Link> : null}
          {hasNext ? <Link href={`/blog?page=${page + 1}`}>Next →</Link> : null}
        </nav>
      </div>
    </>
  );
}
