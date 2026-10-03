import Link from 'next/link';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';
import { ArticleContentEditor } from '@/components/news/article-content-editor';
import { NewsForm } from '@/components/news/news-form';
import { createNewsArticle } from '../actions';

export default async function NewNewsArticlePage() {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  return (
    <main className="space-y-6 py-8 px-5 lg:px-8">
      <Link className="underline" href="/admin/news">← News / Blog</Link>
      <h1 className="text-3xl font-semibold text-gold">New article</h1>
      <NewsForm action={createNewsArticle} submitLabel="Create article">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Type</legend>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2"><input defaultChecked name="articleType" type="radio" value="news" />NEWS</label>
            <label className="flex items-center gap-2"><input name="articleType" type="radio" value="blog" />BLOG</label>
          </div>
        </fieldset>
        <label className="block">Title<input className="mt-1 block w-full border p-2" maxLength={200} name="title" required /></label>
        <label className="block">Subtitle (optional)<input className="mt-1 block w-full border p-2" maxLength={300} name="subtitle" /></label>
        <label className="block">Slug (optional — generated from the title if left blank)
          <input className="mt-1 block w-full border p-2" maxLength={160} name="slug" pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="e.g. spring-education-update" />
        </label>
        <label className="block">Thumbnail
          <input accept="image/avif,image/jpeg,image/png,image/webp" className="mt-1 block w-full border p-2" name="thumbnail" type="file" />
          <span className="mt-1 block text-sm text-muted-foreground">JPG, PNG, WEBP, or AVIF. Maximum 5 MB.</span>
        </label>
        <label className="block">Publication date (UTC)
          <input className="mt-1 block w-full border p-2" name="publicationDate" required type="datetime-local" />
        </label>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Status</legend>
          <label className="flex items-center gap-2"><input defaultChecked name="status" type="radio" value="draft" />Draft</label>
          <label className="flex items-center gap-2"><input name="status" type="radio" value="scheduled" />Scheduled (requires a future publication date)</label>
          <label className="flex items-center gap-2"><input name="status" type="radio" value="published" />Published immediately</label>
        </fieldset>
        <ArticleContentEditor />
      </NewsForm>
    </main>
  );
}
