import Link from 'next/link';

export function NewsTypeSwitch({ active }: { active: 'blog' | 'news' }) {
  return (
    <nav aria-label="Article type" className="flex flex-wrap gap-3">
      <Link
        aria-current={active === 'news' ? 'page' : undefined}
        className={active === 'news' ? 'rounded-full bg-gold px-5 py-2 text-sm font-bold text-primary-foreground' : 'rounded-full border border-gold/45 px-5 py-2 text-sm font-bold text-gold'}
        href="/news"
      >
        NEWS
      </Link>
      <Link
        aria-current={active === 'blog' ? 'page' : undefined}
        className={active === 'blog' ? 'rounded-full bg-gold px-5 py-2 text-sm font-bold text-primary-foreground' : 'rounded-full border border-gold/45 px-5 py-2 text-sm font-bold text-gold'}
        href="/blog"
      >
        BLOG
      </Link>
    </nav>
  );
}
