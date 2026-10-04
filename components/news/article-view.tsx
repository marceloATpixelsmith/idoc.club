import { sanitizeArticleContent } from '@/lib/news/sanitize';
import { BackLink } from '@/components/ui/back-link';

/** Renders one article body. `contentHtml` is already sanitized before storage by
 * lib/news/articles.ts, but this component re-sanitizes it again immediately before rendering as a
 * defense-in-depth second pass (idempotent on already-clean input) rather than trusting that
 * invariant alone -- this is the only place in the codebase that renders article HTML. */
export function ArticleView({ articleType, backHref, backLabel, contentHtml, publicationDate, subtitle, thumbnailUrl, title }: {
  articleType: 'blog' | 'news'; backHref?: string; backLabel?: string; contentHtml: string; publicationDate: string | Date;
  subtitle?: string | null; thumbnailUrl?: string | null; title: string;
}) {
  return (
    <article className="mx-auto w-full max-w-7xl px-5 py-12 lg:px-8">
      {backHref && backLabel ? <BackLink href={backHref}>{backLabel}</BackLink> : null}
      <p className="mt-6 text-xs uppercase tracking-[0.18em] text-gold">{articleType.toUpperCase()}</p>
      <p className="mt-2 text-xs uppercase tracking-[0.18em] text-gold">
        {new Date(publicationDate).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}
      </p>
      <h1 className="mt-4 text-4xl leading-tight lg:text-5xl">{title}</h1>
      {subtitle ? <p className="mt-4 text-xl leading-relaxed text-muted-foreground">{subtitle}</p> : null}
      {thumbnailUrl ? <img alt="" className="mt-8 aspect-[16/9] w-full max-w-3xl rounded-lg border object-cover" src={thumbnailUrl} /> : null}
      {/* eslint-disable-next-line react/no-danger -- rendering server-sanitized HTML only; see file header. */}
      <div className="prose mt-8 max-w-none leading-relaxed" dangerouslySetInnerHTML={{ __html: sanitizeArticleContent(contentHtml) }} />
    </article>
  );
}
