import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ArticleView } from '@/components/news/article-view';
import { getPublicArticleBySlug } from '@/lib/news/articles';
import { baseUrlForServer } from '@/lib/runtime/configuration';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const article = await getPublicArticleBySlug(slug);
  if (!article) return { title: 'Article not found — IDOC News' };
  const title = `${String(article.title)} — IDOC News`;
  const description = article.subtitle ? String(article.subtitle) : 'An update from the International Dressage Officials Club.';
  const canonical = new URL(`/news/${article.slug}`, baseUrlForServer()).toString();
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, type: 'article', publishedTime: new Date(String(article.publication_date)).toISOString() },
  };
}

export default async function NewsArticlePage({ params }: Props) {
  const { slug } = await params;
  const article = await getPublicArticleBySlug(slug);
  if (!article) notFound();
  return (
    <ArticleView
      contentHtml={String(article.content_html)}
      publicationDate={String(article.publication_date)}
      subtitle={article.subtitle ? String(article.subtitle) : null}
      title={String(article.title)}
    />
  );
}
