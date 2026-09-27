import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight, CalendarDays, MapPin } from 'lucide-react';
import { HeroSlider } from '@/components/site/HeroSlider';
import { blogPosts } from '@/lib/content/site';
import { listPublicArticles } from '@/lib/news/articles';
import { listCurrentSeminarsForMember } from '@/lib/seminars/registrations';

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
  const [{ rows: newsRows }, seminarRows] = await Promise.all([
    listPublicArticles('1'),
    listCurrentSeminarsForMember(null),
  ]);
  const upcomingSeminars = seminarRows.slice(0, 4);
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
              {newsRows.length === 0 ? (
                <p className="text-muted-foreground">No news articles have been published yet. Check back soon.</p>
              ) : newsRows.map((item) => (
                <Link key={String(item.slug)} href={`/news/${item.slug}`}>
                  <article className="card-midnight p-7">
                    <p className="text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">
                      {new Date(String(item.publication_date)).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}
                    </p>
                    <h3 className="mt-4 text-2xl leading-snug">{String(item.title)}</h3>
                    {item.subtitle ? <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{String(item.subtitle)}</p> : null}
                  </article>
                </Link>
              ))}
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

            {upcomingSeminars.length === 0 ? (
              <p className="mt-10 text-muted-foreground">No seminars have been published yet. Check back soon.</p>
            ) : (
              <ul className="mt-10 divide-y divide-border border-y border-border">
                {upcomingSeminars.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-col gap-3 py-6 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <h3 className="text-xl">{s.title}</h3>
                      <div className="mt-2 flex flex-wrap items-center gap-5 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                        <span className="inline-flex items-center gap-2">
                          <MapPin className="size-3.5 text-gold" /> {s.location}
                        </span>
                        <span className="inline-flex items-center gap-2">
                          <CalendarDays className="size-3.5 text-gold" /> {new Date(`${s.seminar_date}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
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
          {blogPosts.map((post) => (
            <article key={post.slug} className="card-midnight flex flex-col p-7">
              <p className="text-[0.68rem] uppercase tracking-[0.18em] text-gold">
                {post.date}
              </p>
              <h3 className="mt-4 text-2xl leading-snug">{post.title}</h3>
              <p className="mt-4 flex-1 text-sm leading-relaxed text-muted-foreground">
                {post.excerpt}
              </p>
              <p className="mt-6 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                by {post.author}
              </p>
            </article>
          ))}
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
