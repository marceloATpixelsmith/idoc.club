import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { SeminarListingCard } from '@/components/seminars/member-registrations';
import { HeroSlider } from '@/components/site/HeroSlider';
import { listPublicArticles } from '@/lib/news/articles';
import { listCurrentSeminarsForMember, listPastPublishedSeminars } from '@/lib/seminars/registrations';

export const metadata: Metadata = {
  title: 'IDOC — International Dressage Officials Club',
  description:
    "The International Dressage Officials Club: news, upcoming seminars and the President's blog for dressage judges, stewards and veterinarians.",
  openGraph: {
    title: 'IDOC — International Dressage Officials Club',
    description:
      'News, seminars and education for dressage judges, stewards and veterinarians worldwide.',
  },
};

export default async function Home() {
  const [{ rows: newsRows }, { rows: blogRows }, seminarRows, pastSeminarRows] = await Promise.all([
    listPublicArticles('1', 'news'),
    listPublicArticles('1', 'blog'),
    listCurrentSeminarsForMember(null),
    listPastPublishedSeminars(),
  ]);
  const recentNews = newsRows.slice(0, 4);
  const recentBlog = blogRows.slice(0, 3);
  const upcomingSeminars = seminarRows.slice(0, 4);
  const pastSeminars = pastSeminarRows.slice(0, 4);
  return (
    <>
      <HeroSlider />

      {/* News + Seminars side by side */}
      <section className="mx-auto max-w-7xl px-5 py-20 lg:px-8">
        <div className="grid gap-16 lg:grid-cols-2 lg:gap-24">
          {/* News */}
          <div>
            <div className="flex items-end justify-between gap-6">
              <div>
                <p className="eyebrow">Latest</p>
                <h2 className="mt-3 text-4xl">IDOC News</h2>
              </div>
              <Link
                href="/news"
                className="hidden items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-gold hover:opacity-80 sm:flex"
              >
                All news <ArrowUpRight className="size-4" />
              </Link>
            </div>

            <div className="mt-10 flex flex-col gap-6">
              {recentNews.length === 0 ? (
                <p className="text-muted-foreground">No news articles have been published yet. Check back soon.</p>
              ) : recentNews.map((item) => {
                const external = Boolean(item.external_url);
                const href = external ? String(item.external_url) : `/news/${item.slug}`;
                return (
                  <Link href={href} key={String(item.slug)} rel={external ? 'noopener noreferrer' : undefined} target={external ? '_blank' : undefined}>
                    <article className="card-midnight grid overflow-hidden sm:grid-cols-[9rem_1fr]">
                      {item.thumbnail_url ? (
                        <img alt="" className="h-full min-h-32 w-full object-cover" loading="lazy" src={String(item.thumbnail_url)} />
                      ) : (
                        <div className="hidden sm:block" />
                      )}
                      <div className="p-6">
                        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                          {new Date(String(item.publication_date)).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}
                        </p>
                        <h3 className="mt-3 text-2xl leading-snug">{String(item.title)}</h3>
                        {item.subtitle ? <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{String(item.subtitle)}</p> : null}
                      </div>
                    </article>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Seminars */}
          <div>
            <div className="flex items-end justify-between gap-6">
              <div>
                <p className="eyebrow">Calendar</p>
                <h2 className="mt-3 text-4xl">Upcoming Seminars</h2>
              </div>
              <Link
                href="/seminars"
                className="hidden items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-gold hover:opacity-80 sm:flex"
              >
                Full calendar <ArrowUpRight className="size-4" />
              </Link>
            </div>

            <div className="mt-10">
              <h3 className="section-label">Available seminars</h3>
              {upcomingSeminars.length === 0 ? (
                <p className="mt-6 text-muted-foreground">No seminars have been published yet. Check back soon.</p>
              ) : (
                <ul className="mt-6 w-full max-w-3xl divide-y divide-border border-y border-border">
                  {upcomingSeminars.map((seminar) => (
                    <li key={seminar.id}>
                      <SeminarListingCard href={`/seminars/${seminar.id}`} seminar={seminar} />
                    </li>
                  ))}
                </ul>
              )}
              {pastSeminars.length ? (
                <div className="mt-12">
                  <h3 className="section-label">Past seminars</h3>
                  <ul className="mt-4 w-full max-w-3xl divide-y divide-border border-y border-border">
                    {pastSeminars.map((seminar) => (
                      <li key={seminar.id}>
                        <SeminarListingCard href={`/seminars/${seminar.id}`} seminar={seminar} />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
            <div className="mt-8">
              <a
                className="inline-flex items-center gap-2 rounded-full bg-gold px-6 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-primary-foreground transition-opacity hover:opacity-90"
                href="https://data.fei.org/Calendar/OfficialCourseSearch.aspx"
                rel="noopener noreferrer"
                target="_blank"
              >
                FEI Course Calendar <ArrowUpRight className="size-4" />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* President's blog */}
      <section className="mx-auto max-w-7xl px-5 py-20 lg:px-8">
        <div className="flex items-end justify-between gap-6">
          <div>
            <p className="eyebrow">From the Director</p>
            <h2 className="mt-3 text-4xl">President&apos;s Blog</h2>
          </div>
          <Link
            href="/blog"
            className="hidden items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-gold hover:opacity-80 sm:flex"
          >
            All articles <ArrowUpRight className="size-4" />
          </Link>
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-3">
          {recentBlog.length === 0 ? (
            <p className="text-muted-foreground">No blog articles have been published yet. Check back soon.</p>
          ) : recentBlog.map((post) => {
            const external = Boolean(post.external_url);
            const href = external ? String(post.external_url) : `/blog/${post.slug}`;
            return (
              <Link href={href} key={String(post.slug)} rel={external ? 'noopener noreferrer' : undefined} target={external ? '_blank' : undefined}>
                <article className="card-midnight flex h-full flex-col overflow-hidden">
                  {post.thumbnail_url ? <img alt="" className="aspect-[16/9] w-full object-cover" loading="lazy" src={String(post.thumbnail_url)} /> : null}
                  <div className="flex flex-1 flex-col p-7">
                    <p className="text-xs uppercase tracking-[0.18em] text-gold">
                      {new Date(String(post.publication_date)).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}
                    </p>
                    <h3 className="mt-4 text-2xl leading-snug">{String(post.title)}</h3>
                    {post.subtitle ? <p className="mt-4 flex-1 text-sm leading-relaxed text-muted-foreground">{String(post.subtitle)}</p> : null}
                  </div>
                </article>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Membership CTA */}
      <section className="border-t border-border bg-surface/60">
        <div className="mx-auto flex max-w-7xl flex-col items-start gap-8 px-5 py-20 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="max-w-xl">
            <p className="eyebrow">Membership</p>
            <h2 className="mt-3 text-4xl">Join officials from more than 40 nations</h2>
            <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
              Members receive access to the member area: seminar registration, IDOC
              documents, General Assembly papers and the officials&apos; directory.
            </p>
          </div>
          <div className="flex flex-wrap gap-4">
            <Link
              href="/membership"
              className="bg-gold px-7 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-primary-foreground transition-opacity hover:opacity-90"
            >
              Become a Member
            </Link>
            <Link
              href="/sign-in"
              className="border border-gold/60 px-7 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-gold transition-colors hover:bg-gold hover:text-primary-foreground"
            >
              Member Login
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
