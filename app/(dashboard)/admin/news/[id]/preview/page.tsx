import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';
import { ArticleView } from '@/components/news/article-view';
import { getAdminArticle, STATUS_LABELS } from '@/lib/news/articles';

export default async function NewsArticlePreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const { id } = await params;
  const article = await getAdminArticle(id);
  if (!article) notFound();
  return (
    <main>
      <div className="border-b border-border bg-muted px-5 py-3 text-sm">
        <Link className="underline" href={`/admin/news?articleId=${id}`}>← Back to edit</Link>
        <span className="ml-4">Preview only — status: <strong>{STATUS_LABELS[String(article.status) as keyof typeof STATUS_LABELS]}</strong>. This page is not publicly reachable.</span>
      </div>
      <ArticleView
        articleType={String(article.article_type ?? 'news') === 'blog' ? 'blog' : 'news'}
        contentHtml={String(article.content_html)}
        publicationDate={String(article.publication_date)}
        subtitle={article.subtitle ? String(article.subtitle) : null}
        thumbnailUrl={article.thumbnail_url ? String(article.thumbnail_url) : null}
        title={String(article.title)}
      />
    </main>
  );
}
