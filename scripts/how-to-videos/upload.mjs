// Uploads the rendered How to Use recordings to Cloudinary as idoc/how-to/<section id> (overwriting any earlier take,
// so the URL in lib/how-to/guide.ts never changes). Usage: node scripts/how-to-videos/upload.mjs [dir] [--dry-run]
// Needs CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET (CLOUDINARY_CLOUD_NAME defaults to the IDOC account).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SECTION_IDS = ['directory', 'contact', 'seminars', 'my-seminars'];
const FOLDER = 'idoc/how-to';
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dir = resolve(args.find((arg) => !arg.startsWith('--')) ?? 'out/how-to-videos');
const cloudName = process.env.CLOUDINARY_CLOUD_NAME || 'z6xv27qx';
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

if (!dryRun && (!apiKey || !apiSecret)) {
  console.error('Set CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET (never commit them).');
  process.exit(1);
}

let failed = false;
for (const id of SECTION_IDS) {
  const file = join(dir, `${id}.mp4`);
  if (!existsSync(file)) {
    console.error(`missing ${file}`);
    failed = true;
    continue;
  }
  const publicId = `${FOLDER}/${id}`;
  if (dryRun) {
    console.log(`would upload ${file} -> ${publicId}`);
    continue;
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const signed = `overwrite=true&public_id=${publicId}&timestamp=${timestamp}`;
  const form = new FormData();
  form.set('file', new Blob([readFileSync(file)], { type: 'video/mp4' }), `${id}.mp4`);
  form.set('api_key', apiKey);
  form.set('timestamp', String(timestamp));
  form.set('public_id', publicId);
  form.set('overwrite', 'true');
  form.set('signature', createHash('sha1').update(signed + apiSecret).digest('hex'));
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/video/upload`, { body: form, method: 'POST' });
  const payload = await response.json();
  if (!response.ok) {
    console.error(`${id}: ${payload.error?.message ?? response.status}`);
    failed = true;
    continue;
  }
  console.log(`${id}: uploaded (${payload.secure_url})`);
}
process.exit(failed ? 1 : 0);
