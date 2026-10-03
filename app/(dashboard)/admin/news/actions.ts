'use server';

import { revalidatePath } from 'next/cache';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { requireAdministrator } from '@/lib/membership/authorization';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireCsrfToken } from '@/lib/security/csrf';
import {
  archiveArticle, createArticle, deleteArticle, publishArticle, requireNewsArticleSchema,
  scheduleArticle, unpublishArticle, updateArticle,
} from '@/lib/news/articles';
import { resolveNewsThumbnail } from '@/lib/news/thumbnail';

export type AdminNewsState = { error?: string; success?: string };

async function articleFields(formData: FormData) {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  await requireNewsArticleSchema();
  return {
    articleType: formData.get('articleType'),
    contentHtml: formData.get('contentHtml'),
    externalUrl: formData.get('externalUrl'),
    publicationDate: formData.get('publicationDate'),
    slug: formData.get('slug'),
    status: formData.get('status'),
    subtitle: formData.get('subtitle'),
    thumbnailUrl: await resolveNewsThumbnail(formData),
    title: formData.get('title'),
  };
}

async function run(formData: FormData, operation: () => Promise<void>, success: string): Promise<AdminNewsState> {
  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
    await operation();
    revalidatePath('/admin/news');
    revalidatePath('/news');
    revalidatePath('/blog');
    revalidatePath('/');
    return { success };
  } catch (error) {
    if (error instanceof Error && ['AuthorizationError', 'CsrfError', 'NewsValidationError', 'NewsThumbnailUploadError'].includes(error.name)) return { error: error.message };
    return { error: 'The article could not be saved.' };
  }
}

export async function createNewsArticle(_state: AdminNewsState, formData: FormData): Promise<AdminNewsState> {
  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
    await createArticle(await articleFields(formData));
    for (const path of ['/admin/news','/news','/blog','/']) revalidatePath(path);
    return { success: 'Article created.' };
  } catch (error) {
    if (error instanceof Error && ['AuthorizationError', 'CsrfError', 'NewsValidationError', 'NewsThumbnailUploadError'].includes(error.name)) return { error: error.message };
    return { error: 'The article could not be created.' };
  }
}

export async function updateNewsArticle(_state: AdminNewsState, formData: FormData) {
  const id = formData.get('id');
  return run(formData, async () => updateArticle(id, await articleFields(formData)), 'Article saved.');
}

export async function publishNewsArticle(_state: AdminNewsState, formData: FormData) {
  return run(formData, () => publishArticle(formData.get('id')), 'Article published.');
}

export async function unpublishNewsArticle(_state: AdminNewsState, formData: FormData) {
  return run(formData, () => unpublishArticle(formData.get('id')), 'Article moved back to draft.');
}

export async function scheduleNewsArticle(_state: AdminNewsState, formData: FormData) {
  return run(formData, () => scheduleArticle(formData.get('id'), formData.get('publicationDate')), 'Article scheduled.');
}

export async function archiveNewsArticle(_state: AdminNewsState, formData: FormData) {
  return run(formData, () => archiveArticle(formData.get('id')), 'Article archived.');
}

export async function deleteNewsArticle(_state: AdminNewsState, formData: FormData) {
  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
    await deleteArticle(formData.get('id'));
  } catch (error) {
    if (error instanceof Error && ['AuthorizationError', 'CsrfError', 'NewsValidationError'].includes(error.name)) return { error: error.message };
    return { error: 'The article could not be deleted.' };
  }
  revalidatePath('/admin/news');
  revalidatePath('/news');
  revalidatePath('/blog');
  revalidatePath('/');
  redirect('/admin/news');
}
