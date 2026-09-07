'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { requireCsrfToken } from '@/lib/security/csrf';
import {
  archiveArticle, createArticle, deleteArticle, publishArticle,
  scheduleArticle, unpublishArticle, updateArticle,
} from '@/lib/news/articles';

export type AdminNewsState = { error?: string; success?: string };

function articleFields(formData: FormData) {
  return {
    contentHtml: formData.get('contentHtml'), publicationDate: formData.get('publicationDate'),
    slug: formData.get('slug'), status: formData.get('status'), subtitle: formData.get('subtitle'), title: formData.get('title'),
  };
}

async function run(formData: FormData, operation: () => Promise<void>, success: string): Promise<AdminNewsState> {
  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
    await operation();
    revalidatePath('/admin/news');
    revalidatePath('/news');
    return { success };
  } catch (error) {
    if (error instanceof Error && ['AuthorizationError', 'CsrfError', 'NewsValidationError'].includes(error.name)) return { error: error.message };
    return { error: 'The article could not be saved.' };
  }
}

export async function createNewsArticle(_state: AdminNewsState, formData: FormData) {
  let id: number;
  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
    id = await createArticle(articleFields(formData));
  } catch (error) {
    if (error instanceof Error && ['AuthorizationError', 'CsrfError', 'NewsValidationError'].includes(error.name)) return { error: error.message };
    return { error: 'The article could not be created.' };
  }
  revalidatePath('/admin/news');
  revalidatePath('/news');
  redirect(`/admin/news/${id}`);
}

export async function updateNewsArticle(_state: AdminNewsState, formData: FormData) {
  const id = formData.get('id');
  return run(formData, () => updateArticle(id, articleFields(formData)), 'Article saved.');
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
  redirect('/admin/news');
}
