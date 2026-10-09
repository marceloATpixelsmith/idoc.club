import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { SeminarListingCard } from '@/components/seminars/member-registrations';
import { HeroSlider } from '@/components/site/HeroSlider';
import { Button } from '@/components/ui/button';
import { PublicNewsCard } from '@/components/news/public-news-card';
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
              ) : recentNews.map((item) => <PublicNewsCard item={item as never} key={String(item.slug)} />)}
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
                className="idoc-secondary-button px-6 py-3 text-sm"
                href="https://data.fei.org/Calendar/OfficialCourseSearch.aspx"
                rel="noopener noreferrer"
                target="_blank"
              >
                FEI Course Calendar <ArrowUpRight className="size-4" />
              </a>
            </div>

            {/* President's blog */}
            <div className="mt-16 border-t border-border pt-16">
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

              <div className="mt-10 flex flex-col gap-6">
                {recentBlog.length === 0 ? (
                  <p className="text-muted-foreground">No blog articles have been published yet. Check back soon.</p>
                ) : recentBlog.map((post) => (
                  <PublicNewsCard basePath="/blog" item={post as never} key={String(post.slug)} />
                ))}
              </div>
            </div>
          </div>
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
            <Button asChild className="h-auto px-7 py-3 text-xs font-semibold uppercase tracking-[0.2em]">
              <Link href="/membership">Become a Member</Link>
            </Button>
            <Button asChild className="h-auto px-7 py-3 text-xs font-semibold uppercase tracking-[0.2em]" variant="secondary">
              <Link href="/sign-in">Member Login</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
