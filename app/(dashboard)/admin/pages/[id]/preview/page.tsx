import { notFound } from 'next/navigation';
import { sanitizeArticleContent } from '@/lib/news/sanitize';
import { getAdminContentPage } from '@/lib/content/pages';

export default async function ContentPagePreview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await getAdminContentPage(id);
  if (!page) notFound();
  return <main className="mx-auto max-w-4xl px-5 py-12"><p className="eyebrow">Administrator preview — not public</p><h1 className="mt-4 font-display text-4xl">{String(page.title)}</h1>{page.summary ? <p className="mt-3 text-lg text-muted-foreground">{String(page.summary)}</p> : null}<div className="prose mt-8 max-w-none" dangerouslySetInnerHTML={{ __html: sanitizeArticleContent(String(page.content_html)) }} /></main>;
}
