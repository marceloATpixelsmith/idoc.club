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
      <div className="mx-auto max-w-7xl px-5 pb-8 pt-10 lg:px-8 lg:pt-12">
        {rows.length === 0 ? (
          <p className="py-10 text-muted-foreground">No blog articles have been published yet. Check back soon.</p>
        ) : (
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
            {rows.map((item) => {
              const external = Boolean(item.external_url);
              const href = external ? String(item.external_url) : `/blog/${String(item.slug)}`;
              return (
                <Link
                  href={href}
                  key={String(item.slug)}
                  rel={external ? 'noopener noreferrer' : undefined}
                  target={external ? '_blank' : undefined}
                >
                  <article className="card-midnight overflow-hidden">
                    {item.thumbnail_url ? (
                      <img alt="" className="aspect-[16/9] w-full object-cover" loading="lazy" src={String(item.thumbnail_url)} />
                    ) : null}
                    <div className="p-6">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                        {new Date(item.publication_date).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}
                      </p>
                      <h3 className="mt-3 text-2xl leading-snug">{String(item.title)}</h3>
                      {item.subtitle ? <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{String(item.subtitle)}</p> : null}
                    </div>
                  </article>
                </Link>
              );
            })}
          </div>
        )}
        <nav className="flex gap-4 pt-6">
          {page > 1 ? <Link href={`/blog?page=${page - 1}`}>← Previous</Link> : null}
          {hasNext ? <Link href={`/blog?page=${page + 1}`}>Next →</Link> : null}
        </nav>
      </div>
    </>
  );
}
