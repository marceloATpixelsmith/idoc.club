import Link from 'next/link';
import { Eye } from 'lucide-react';
import { notFound } from 'next/navigation';
import { AdminFormDrawer } from '@/components/admin/admin-form-drawer';
import { AdminFormSection } from '@/components/admin/admin-form-section';
import { ArticleAccessField } from '@/components/news/article-access-field';
import { ArticleContentEditor } from '@/components/news/article-content-editor';
import { ArticleThumbnailField } from '@/components/news/article-thumbnail-field';
import { NewsForm } from '@/components/news/news-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getAdminArticle, STATUS_LABELS } from '@/lib/news/articles';
import { createNewsArticle, updateNewsArticle } from './actions';

function toDateOnlyUtc(value: unknown): string {
  return new Date(String(value)).toISOString().slice(0, 10);
}

function TypeStatusFields({ articleType = 'news', status = 'draft' }: { articleType?: string; status?: string }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Type</legend>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2"><input defaultChecked={articleType === 'news'} name="articleType" type="radio" value="news" />NEWS</label>
          <label className="flex items-center gap-2"><input defaultChecked={articleType === 'blog'} name="articleType" type="radio" value="blog" />BLOG</label>
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Status</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(['draft', 'scheduled', 'published', 'archived'] as const).map((value) => (
            <label className="flex items-center gap-2" key={value}>
              <input defaultChecked={status === value} name="status" type="radio" value={value} />
              {STATUS_LABELS[value]}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

export async function AdminNewsDrawer({ articleId, isNew = false }: { articleId?: string; isNew?: boolean }) {
  if (isNew) {
    return (
      <AdminFormDrawer closeHref="/admin/news" title="News / Blog">
        <div className="space-y-4 px-5 py-6 lg:px-8">
          <NewsForm action={createNewsArticle} submitLabel="Create article">
            <AdminFormSection description="Choose where this item belongs and how it should be published." title="Publishing">
              <TypeStatusFields />
              <ArticleAccessField />
              <div className="max-w-sm space-y-1.5">
                <Label htmlFor="publicationDate">Publication date (UTC)</Label>
                <Input id="publicationDate" name="publicationDate" required type="date" />
              </div>
            </AdminFormSection>
            <AdminFormSection title="Article details">
              <div className="space-y-4">
                <div className="space-y-1.5"><Label htmlFor="title">Title</Label><Input id="title" maxLength={200} name="title" required /></div>
                <div className="space-y-1.5"><Label htmlFor="subtitle">Subtitle (optional)</Label><Input id="subtitle" maxLength={300} name="subtitle" /></div>
                <div className="space-y-1.5"><Label htmlFor="slug">Slug (optional)</Label><Input id="slug" maxLength={160} name="slug" pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="spring-education-update" /></div>
                <div className="space-y-1.5">
                  <Label htmlFor="externalUrl">External link (optional)</Label>
                  <Input id="externalUrl" maxLength={2000} name="externalUrl" placeholder="https://www.fei.org/..." type="url" />
                  <p className="text-sm text-muted-foreground">When present, public cards open this URL in a new tab. An internal article body is optional.</p>
                </div>
              </div>
            </AdminFormSection>
            <AdminFormSection title="Image">
              <ArticleThumbnailField id="thumbnail" label="Thumbnail" />
            </AdminFormSection>
            <AdminFormSection title="Content">
              <ArticleContentEditor />
            </AdminFormSection>
          </NewsForm>
        </div>
      </AdminFormDrawer>
    );
  }

  const article = articleId ? await getAdminArticle(articleId) : null;
  if (!article) notFound();
  const status = String(article.status);
  const articleType = String(article.article_type ?? 'news');
  return (
    <AdminFormDrawer closeHref="/admin/news" title="News / Blog">
      <div className="space-y-4 px-5 py-6 lg:px-8">
        <div className="flex justify-end">
          <Button asChild variant="secondary">
            <Link href={`/admin/news/${articleId}/preview`}><Eye aria-hidden="true" />Preview</Link>
          </Button>
        </div>
        <NewsForm action={updateNewsArticle} submitLabel="Save changes">
          <input name="id" type="hidden" value={articleId} />
          <input name="existingThumbnailUrl" type="hidden" value={article.thumbnail_url ? String(article.thumbnail_url) : ''} />
          <AdminFormSection description="Type, publication status, and schedule are managed together." title="Publishing">
            <TypeStatusFields articleType={articleType} status={status} />
            <ArticleAccessField initialAudience={Array.isArray(article.audience) ? article.audience.map(String) : ['public']} />
            <div className="max-w-sm space-y-1.5">
              <Label htmlFor="publicationDate">Publication date (UTC)</Label>
              <Input defaultValue={toDateOnlyUtc(article.publication_date)} id="publicationDate" name="publicationDate" required type="date" />
            </div>
          </AdminFormSection>
          <AdminFormSection title="Article details">
            <div className="space-y-4">
              <div className="space-y-1.5"><Label htmlFor="title">Title</Label><Input defaultValue={String(article.title)} id="title" maxLength={200} name="title" required /></div>
              <div className="space-y-1.5"><Label htmlFor="subtitle">Subtitle (optional)</Label><Input defaultValue={article.subtitle ? String(article.subtitle) : ''} id="subtitle" maxLength={300} name="subtitle" /></div>
              <div className="space-y-1.5"><Label htmlFor="slug">Slug</Label><Input defaultValue={String(article.slug)} id="slug" maxLength={160} name="slug" pattern="[a-z0-9]+(-[a-z0-9]+)*" required /></div>
              <div className="space-y-1.5">
                <Label htmlFor="externalUrl">External link (optional)</Label>
                <Input defaultValue={article.external_url ? String(article.external_url) : ''} id="externalUrl" maxLength={2000} name="externalUrl" placeholder="https://www.fei.org/..." type="url" />
                <p className="text-sm text-muted-foreground">When present, public cards open this URL in a new tab. An internal article body is optional.</p>
              </div>
            </div>
          </AdminFormSection>
          <AdminFormSection title="Image">
            <div className="space-y-3">
              <ArticleThumbnailField allowRemoval={Boolean(article.thumbnail_url)} id="thumbnail" initialImageUrl={article.thumbnail_url ? String(article.thumbnail_url) : null} label="Replace image" />
            </div>
          </AdminFormSection>
          <AdminFormSection title="Content">
            <ArticleContentEditor initialHtml={String(article.content_html)} />
          </AdminFormSection>
        </NewsForm>
      </div>
    </AdminFormDrawer>
  );
}
