import { timingSafeEqual } from 'node:crypto';

export const ACCOUNT_DELIVERY_BATCH_LIMIT = 20;
export const ACCOUNT_DELIVERY_LEASE_MS = 5 * 60 * 1000;
type DeliveryResult = { status: 'dead_lettered' | 'delivered' | 'empty' | 'ineligible' | 'lease_lost' | 'retryable' };

export async function processDeliveryBatch(deliver: () => Promise<DeliveryResult>, limit = ACCOUNT_DELIVERY_BATCH_LIMIT) {
  const summary = { deadLettered: 0, delivered: 0, ineligible: 0, leaseLost: 0, retryable: 0 };
  for (let processed = 0; processed < limit; processed += 1) {
    const result = await deliver();
    if (result.status === 'empty') break;
    if (result.status === 'dead_lettered') summary.deadLettered += 1;
    else if (result.status === 'delivered') summary.delivered += 1;
    else if (result.status === 'ineligible') summary.ineligible += 1;
    else if (result.status === 'lease_lost') summary.leaseLost += 1;
    else summary.retryable += 1;
  }
  return summary;
}

function authorized(request: Request, secret: string | undefined) {
  const authorization = request.headers.get('authorization');
  if (!secret || !authorization?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(authorization.slice('Bearer '.length));
  const expected = Buffer.from(secret);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export async function handleAccountDeliveryCron(request: Request, dependencies: {
  processBatch: () => Promise<Record<string, number>>;
  reportFailure: () => void | Promise<void>;
  secret: string | undefined;
}) {
  if (!authorized(request, dependencies.secret)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return Response.json(await dependencies.processBatch());
  } catch {
    await dependencies.reportFailure();
    return Response.json({ error: 'Worker failed' }, { status: 500 });
  }
}
