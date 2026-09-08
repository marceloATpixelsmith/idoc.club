import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';
import { ArticleContentEditor } from '@/components/news/article-content-editor';
import { NewsForm } from '@/components/news/news-form';
import { getAdminArticle, STATUS_LABELS } from '@/lib/news/articles';
import {
  archiveNewsArticle, deleteNewsArticle, publishNewsArticle,
  scheduleNewsArticle, unpublishNewsArticle, updateNewsArticle,
} from '../actions';

function toDatetimeLocalUtc(value: unknown): string {
  return new Date(String(value)).toISOString().slice(0, 16);
}

export default async function EditNewsArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const { id } = await params;
  const article = await getAdminArticle(id);
  if (!article) notFound();
  const status = String(article.status);
  return (
    <main className="space-y-8 py-8 px-5 lg:px-8">
      <Link className="underline" href="/admin/news">← News / Blog</Link>
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{String(article.title)}</h1>
          <p className="text-muted-foreground">Status: <strong>{STATUS_LABELS[status as keyof typeof STATUS_LABELS]}</strong></p>
        </div>
        <Link className="underline" href={`/admin/news/${id}/preview`}>Preview</Link>
      </header>

      <section className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <NewsForm action={updateNewsArticle} submitLabel="Save changes">
          <input name="id" type="hidden" value={id} />
          <label className="block">Title<input className="mt-1 block w-full border p-2" defaultValue={String(article.title)} maxLength={200} name="title" required /></label>
          <label className="block">Subtitle (optional)<input className="mt-1 block w-full border p-2" defaultValue={article.subtitle ? String(article.subtitle) : ''} maxLength={300} name="subtitle" /></label>
          <label className="block">Slug
            <input className="mt-1 block w-full border p-2" defaultValue={String(article.slug)} maxLength={160} name="slug" pattern="[a-z0-9]+(-[a-z0-9]+)*" required />
          </label>
          <label className="block">Publication date (UTC)
            <input className="mt-1 block w-full border p-2" defaultValue={toDatetimeLocalUtc(article.publication_date)} name="publicationDate" required type="datetime-local" />
          </label>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Status</legend>
            {(['draft', 'scheduled', 'published', 'archived'] as const).map((value) => (
              <label className="flex items-center gap-2" key={value}><input defaultChecked={status === value} name="status" type="radio" value={value} />{STATUS_LABELS[value]}</label>
            ))}
          </fieldset>
          <ArticleContentEditor initialHtml={String(article.content_html)} />
        </NewsForm>

        <aside className="space-y-6">
          <section className="rounded-lg border p-4">
            <h2 className="mb-3 font-semibold">Quick actions</h2>
            <div className="space-y-3">
              {status !== 'published' ? (
                <NewsForm action={publishNewsArticle} pendingLabel="Publishing" submitLabel="Publish now">
                  <input name="id" type="hidden" value={id} />
                </NewsForm>
              ) : null}
              {status === 'published' ? (
                <NewsForm action={unpublishNewsArticle} pendingLabel="Unpublishing" submitLabel="Unpublish">
                  <input name="id" type="hidden" value={id} />
                </NewsForm>
              ) : null}
              {status !== 'archived' ? (
                <NewsForm action={archiveNewsArticle} pendingLabel="Archiving" submitLabel="Archive">
                  <input name="id" type="hidden" value={id} />
                </NewsForm>
              ) : null}
              {status === 'draft' || status === 'archived' ? (
                <NewsForm action={deleteNewsArticle} pendingLabel="Deleting" submitLabel="Delete permanently">
                  <input name="id" type="hidden" value={id} />
                </NewsForm>
              ) : null}
            </div>
          </section>
          <section className="rounded-lg border p-4">
            <h2 className="mb-3 font-semibold">Reschedule</h2>
            <NewsForm action={scheduleNewsArticle} pendingLabel="Scheduling" submitLabel="Set schedule">
              <input name="id" type="hidden" value={id} />
              <label className="block text-sm">Publication date (UTC)<input className="mt-1 block w-full border p-2" name="publicationDate" required type="datetime-local" /></label>
            </NewsForm>
          </section>
        </aside>
      </section>
    </main>
  );
}
