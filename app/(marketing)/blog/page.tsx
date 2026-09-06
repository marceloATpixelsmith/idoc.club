import type { Metadata } from 'next';
import { blogPosts } from '@/lib/content/site';
import { PageHeader } from '@/components/site/PageHeader';

export const metadata: Metadata = {
  title: "President's Blog — IDOC",
  description:
    "Articles from the IDOC President on judging standards, welfare, data and the evolving role of the dressage official.",
  openGraph: {
    title: "President's Blog — IDOC",
    description: 'Reflections on judging standards, horse welfare and integrity in dressage sport.',
  },
};

export default function BlogPage() {
  return (
    <>
      <PageHeader
        eyebrow="From the Director"
        title="President's Blog"
        intro="Reflections on judging standards, horse welfare, data and integrity by IDOC President Hans Christian Matthiesen."
      />
      <div className="mx-auto max-w-7xl px-5 pb-8 lg:px-8">
        <ul className="divide-y divide-border border-t border-border">
          {blogPosts.map((post) => (
            <li key={post.slug} className="py-10">
              <p className="text-[0.68rem] uppercase tracking-[0.18em] text-gold">
                {post.date} · by {post.author}
              </p>
              <h2 className="mt-4 text-3xl leading-snug">{post.title}</h2>
              <p className="mt-4 leading-relaxed text-muted-foreground">{post.excerpt}</p>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
