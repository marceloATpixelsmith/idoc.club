import 'server-only';
import * as Sentry from '@sentry/nextjs';

export const dynamic = 'force-dynamic';

function allowed() {
  return process.env.VERCEL_ENV === 'preview' || process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT === 'staging';
}

export async function POST() {
  if (!allowed()) return Response.json({ error: 'Not found' }, { status: 404 });

  const error = new Error('IDOC_SENTRY_SERVER_TEST');
  Sentry.captureException(error, { tags: { idoc_diagnostic: 'sentry-server-test' } });
  await Sentry.flush(2000);
  return Response.json({ ok: true });
}
