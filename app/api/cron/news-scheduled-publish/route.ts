import 'server-only';

import { handleAccountDeliveryCron } from '@/lib/notifications/account-delivery-worker-core';
import { publishScheduledArticles } from '@/lib/news/articles';
import { cronSecretForServer } from '@/lib/runtime/configuration';
import { logError } from '@/lib/observability/logger';

export async function GET(request: Request) {
  return handleAccountDeliveryCron(request, {
    processBatch: publishScheduledArticles,
    reportFailure: () => logError('news_scheduled_publish_failed'),
    secret: cronSecretForServer(),
  });
}
