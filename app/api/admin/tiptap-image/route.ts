import { NextResponse } from 'next/server';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { requireAdministrator } from '@/lib/membership/authorization';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireCsrfTokenValue } from '@/lib/security/csrf';
import { MAX_IMAGE_UPLOAD_BYTES, NewsThumbnailUploadError, uploadCloudinaryImage } from '@/lib/news/thumbnail';

export const runtime = 'nodejs';

/** AUTHENTICATED, CSRF-BOUND IMAGE UPLOAD FOR EVERY ADMIN TIPTAP FIELD. */
export async function POST(request: Request) {
  try {
    await requireCsrfTokenValue(
      request.headers.get('x-csrf-token'),
      await rawCanonicalSessionId(),
      await rawCanonicalUserId(),
    );
    const actor = await requireAccountAccess('administration');
    requireAdministrator(actor);

    const contentLength = Number(request.headers.get('content-length') ?? 0);
    if (contentLength > MAX_IMAGE_UPLOAD_BYTES + 64 * 1024) {
      return NextResponse.json({ error: 'Image must be 5 MB or smaller.' }, { status: 413 });
    }
    const formData = await request.formData();
    const image = formData.get('image');
    if (!(image instanceof File) || image.size === 0) {
      return NextResponse.json({ error: 'Choose an image to upload.' }, { status: 400 });
    }

    const url = await uploadCloudinaryImage(image, 'idoc/rich-content');
    return NextResponse.json({ url });
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'You are not authorized to upload editor images.' }, { status: 403 });
    }
    if (error instanceof Error && error.name === 'CsrfError') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof NewsThumbnailUploadError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('tiptap_image_upload_failed', error);
    return NextResponse.json({ error: 'The image could not be uploaded.' }, { status: 500 });
  }
}
