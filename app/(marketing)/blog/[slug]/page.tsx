import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ArticleView } from '@/components/news/article-view';
import { getPublicArticleBySlug } from '@/lib/news/articles';
import { baseUrlForServer } from '@/lib/runtime/configuration';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const article = await getPublicArticleBySlug(slug, 'blog');
  if (!article) return { title: 'Blog article not found — IDOC' };
  const title = `${String(article.title)} — IDOC Blog`;
  const description = article.subtitle ? String(article.subtitle) : 'An article from the International Dressage Officials Club.';
  const canonical = new URL(`/blog/${article.slug}`, baseUrlForServer()).toString();
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      type: 'article',
      publishedTime: new Date(String(article.publication_date)).toISOString(),
      images: article.thumbnail_url ? [{ url: String(article.thumbnail_url) }] : undefined,
    },
  };
}

export default async function BlogArticlePage({ params }: Props) {
  const { slug } = await params;
  const article = await getPublicArticleBySlug(slug, 'blog');
  if (!article) notFound();
  return (
    <ArticleView
      articleType="blog"
      contentHtml={String(article.content_html)}
      publicationDate={String(article.publication_date)}
      subtitle={article.subtitle ? String(article.subtitle) : null}
      thumbnailUrl={article.thumbnail_url ? String(article.thumbnail_url) : null}
      title={String(article.title)}
    />
  );
}
