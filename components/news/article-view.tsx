import { sanitizeArticleContent } from '@/lib/news/sanitize';

/** Renders one article body. `contentHtml` is already sanitized before storage by
 * lib/news/articles.ts, but this component re-sanitizes it again immediately before rendering as a
 * defense-in-depth second pass (idempotent on already-clean input) rather than trusting that
 * invariant alone -- this is the only place in the codebase that renders article HTML. */
export function ArticleView({ contentHtml, publicationDate, subtitle, title }: {
  contentHtml: string; publicationDate: string | Date; subtitle?: string | null; title: string;
}) {
  return (
    <article className="mx-auto max-w-3xl px-5 py-12 lg:px-8">
      <p className="text-[0.68rem] uppercase tracking-[0.18em] text-gold">
        {new Date(publicationDate).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}
      </p>
      <h1 className="mt-4 text-4xl leading-tight lg:text-5xl">{title}</h1>
      {subtitle ? <p className="mt-4 text-xl leading-relaxed text-muted-foreground">{subtitle}</p> : null}
      {/* eslint-disable-next-line react/no-danger -- rendering server-sanitized HTML only; see file header. */}
      <div className="prose mt-8 max-w-none leading-relaxed" dangerouslySetInnerHTML={{ __html: sanitizeArticleContent(contentHtml) }} />
    </article>
  );
}
