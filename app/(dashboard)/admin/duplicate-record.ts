'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { requireCsrfToken } from '@/lib/security/csrf';
import { createArticle, getAdminArticle } from '@/lib/news/articles';
import { createSeminar, getAdminSeminar } from '@/lib/seminars/seminars';

type DuplicableTable = 'news' | 'seminars';
type DuplicateResult = { error?: string; success?: string };

function dateOnly(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

//EACH DATABASE HELPER CHECKS ADMIN AUTHORIZATION. NEVER CLONE TRANSACTIONAL CHILD RECORDS.
export async function duplicateAdminRecord(table: DuplicableTable, id: number, csrfToken: string): Promise<DuplicateResult> {
  try {
    const form = new FormData();
    form.set('csrf_token', csrfToken);
    await requireCsrfToken(form, await rawCanonicalSessionId(), await rawCanonicalUserId());
    if (!Number.isSafeInteger(id) || id < 1) return { error: 'Invalid record.' };

    if (table === 'news') {
      const source = await getAdminArticle(id);
      if (!source) return { error: 'Article not found.' };
      const title = `${String(source.title).slice(0, 193)} (copy)`;
      await createArticle({
        articleType: source.article_type,
        audience: source.audience ?? ['public'],
        contentHtml: source.content_html,
        externalUrl: source.external_url ?? '',
        publicationDate: dateOnly(source.publication_date),
        slug: `${String(source.slug).slice(0, 140).replace(/-+$/, '')}-copy-${randomUUID().slice(0, 8)}`,
        status: 'draft',
        subtitle: source.subtitle ?? '',
        thumbnailUrl: source.thumbnail_url ?? '',
        title,
      });
      revalidatePath('/admin/news');
      return { success: 'Article duplicated as a draft.' };
    }

    if (table === 'seminars') {
      const source = await getAdminSeminar(id);
      if (!source) return { error: 'Seminar not found.' };
      await createSeminar({
        accommodationInformation: source.accommodation_information,
        application: source.application,
        capacity: source.capacity,
        courseDirectors: source.course_directors,
        courseVenueInformation: source.course_venue_information,
        endDate: dateOnly(source.end_date),
        isFei: source.is_fei,
        language: source.language,
        levels: source.levels,
        location: source.location,
        price: source.member_price_cents / 100,
        participantProfile: source.participant_profile,
        registrationDeadline: dateOnly(source.registration_deadline),
        startDate: dateOnly(source.start_date),
        status: 'draft',
        title: `${source.title.slice(0, 193)} (copy)`,
      });
      revalidatePath('/admin/seminars');
      return { success: 'Seminar duplicated as a draft.' };
    }
    return { error: 'Unsupported record type.' };
  } catch {
    return { error: 'Could not duplicate this record. Please try again.' };
  }
}
