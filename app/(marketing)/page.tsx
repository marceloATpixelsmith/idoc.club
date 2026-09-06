import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight, CalendarDays, MapPin } from 'lucide-react';
import { HeroSlider } from '@/components/site/HeroSlider';
import { blogPosts, news, seminars } from '@/lib/content/site';

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

export default function Home() {
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
              {news.slice(0, 4).map((item) => (
                <article key={item.slug} className="card-midnight p-7">
                  <div className="flex items-center gap-3 text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">
                    <span className="text-gold">{item.category}</span>
                    <span className="h-px w-6 bg-border" />
                    <span>{item.date}</span>
                  </div>
                  <h3 className="mt-4 text-2xl leading-snug">{item.title}</h3>
                  <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                    {item.excerpt}
                  </p>
                </article>
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

            <ul className="mt-10 divide-y divide-border border-y border-border">
              {seminars.map((s) => (
                <li
                  key={s.title}
                  className="flex flex-col gap-3 py-6 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <h3 className="text-xl">{s.title}</h3>
                    <div className="mt-2 flex flex-wrap items-center gap-5 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                      <span className="inline-flex items-center gap-2">
                        <MapPin className="size-3.5 text-gold" /> {s.location}
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <CalendarDays className="size-3.5 text-gold" /> {s.date}
                      </span>
                    </div>
                  </div>
                  <span className="shrink-0 border border-border px-3 py-1 text-[0.68rem] uppercase tracking-[0.16em] text-muted-foreground">
                    {s.audience}
                  </span>
                </li>
              ))}
            </ul>
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
