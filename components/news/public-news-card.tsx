import Link from 'next/link';

////ONLY TRANSFORM IMAGES HOSTED ON OUR CLOUDINARY ACCOUNT; PRESERVE OTHER URLS.
function optimizedThumbnail(source: string, width: number): string {
  try {
    const url = new URL(source);
    if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com') return source;
    if (!/^\/z6xv27qx\/image\/upload\//.test(url.pathname)) return source;
    url.pathname = url.pathname.replace(
      '/image/upload/',
      `/image/upload/f_auto,q_auto,c_limit,w_${width}/`,
    );
    return url.toString();
  } catch {
    return source;
  }
}

export type PublicNewsCardItem = {
  external_url?: unknown;
  publication_date: string | Date;
  slug: unknown;
  subtitle?: unknown;
  thumbnail_url?: unknown;
  title: unknown;
};

export function PublicNewsCard({ item, basePath = '/news' }: { item: PublicNewsCardItem; basePath?: '/news' | '/blog' }) {
  const external = Boolean(item.external_url);
  const href = external ? String(item.external_url) : `${basePath}/${String(item.slug)}`;
  return (
    <Link href={href} rel={external ? 'noopener noreferrer' : undefined} target={external ? '_blank' : undefined}>
      <article className="card-midnight overflow-hidden">
        {item.thumbnail_url ? (
          <img
            alt=""
            className="aspect-[16/9] w-full object-cover"
            loading="lazy"
            decoding="async"
            width={648}
            height={365}
            sizes="(min-width: 1024px) 648px, (min-width: 640px) 90vw, 100vw"
            src={optimizedThumbnail(String(item.thumbnail_url), 768)}
            srcSet={[384, 648, 768, 1024]
              .map((width) => `${optimizedThumbnail(String(item.thumbnail_url), width)} ${width}w`)
              .join(', ')}
          />
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
