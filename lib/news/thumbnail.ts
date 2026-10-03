import 'server-only';

import { createHash } from 'node:crypto';

const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

export class NewsThumbnailUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NewsThumbnailUploadError';
  }
}

export async function resolveNewsThumbnail(formData: FormData): Promise<string | null> {
  const existing = typeof formData.get('existingThumbnailUrl') === 'string'
    ? String(formData.get('existingThumbnailUrl')).trim()
    : '';
  if (formData.get('removeThumbnail') === '1') return null;

  const file = formData.get('thumbnail');
  if (!(file instanceof File) || file.size === 0) return existing || null;
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new NewsThumbnailUploadError('Thumbnail must be a JPG, PNG, WEBP, or AVIF image.');
  }
  if (file.size > MAX_THUMBNAIL_BYTES) {
    throw new NewsThumbnailUploadError('Thumbnail must be 5 MB or smaller.');
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || 'z6xv27qx';
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new NewsThumbnailUploadError('Image upload is not configured. Add the Cloudinary API credentials to this environment.');
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = 'idoc/news';
  const signature = createHash('sha1').update(`folder=${folder}&timestamp=${timestamp}${apiSecret}`).digest('hex');
  const upload = new FormData();
  upload.set('file', file);
  upload.set('api_key', apiKey);
  upload.set('timestamp', String(timestamp));
  upload.set('folder', folder);
  upload.set('signature', signature);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    body: upload,
    method: 'POST',
  });
  const payload = await response.json() as { error?: { message?: string }; secure_url?: string };
  if (!response.ok || !payload.secure_url) {
    throw new NewsThumbnailUploadError(payload.error?.message || 'The thumbnail could not be uploaded.');
  }
  return payload.secure_url;
}
