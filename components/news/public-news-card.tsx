import Link from 'next/link';

export type PublicNewsCardItem = {
  external_url?: unknown;
  publication_date: string | Date;
  slug: unknown;
  subtitle?: unknown;
  thumbnail_url?: unknown;
  title: unknown;
};

export function PublicNewsCard({ item }: { item: PublicNewsCardItem }) {
  const external = Boolean(item.external_url);
  const href = external ? String(item.external_url) : `/news/${String(item.slug)}`;
  return (
    <Link href={href} rel={external ? 'noopener noreferrer' : undefined} target={external ? '_blank' : undefined}>
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
}
