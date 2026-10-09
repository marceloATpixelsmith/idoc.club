/**
 * Bridge Next.js' existing HTTP server spans into an OTLP delta histogram.
 * Next.js 15 emits http.method server spans but not http.server.duration metrics.
 * No URLs, request bodies, session identifiers, IDs or database data are exported.
 */
type ServerSpan = {
  kind: number;
  attributes: Record<string, unknown>;
  duration: [number, number];
  endTime: [number, number];
};
const bounds = [5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 10000];

export function serverDurationMetricPayload(spans: readonly ServerSpan[]) {
  const dataPoints = [];
  for (const span of spans) {
    // OpenTelemetry SpanKind.SERVER === 1.
    if (span.kind !== 1) continue;
    const rawMethod = span.attributes['http.method'];
    const method = typeof rawMethod === 'string' && /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(rawMethod)
      ? rawMethod : null;
    if (!method) continue;
    const ms = span.duration[0] * 1000 + span.duration[1] / 1e6;
    if (!Number.isFinite(ms) || ms < 0) continue;
    const status = span.attributes['http.status_code'];
    const attrs: Array<{ key: string; value: { stringValue: string } }> = [
      { key: 'http.method', value: { stringValue: method } },
    ];
    // Only route *templates*, never actual URLs or resource identifiers.
    const route = span.attributes['http.route'];
    if (typeof route === 'string' && route.startsWith('/') &&
        route.length <= 120 && !/[?#]/.test(route) &&
        route.split('/').every(segment => !segment || /^[a-zA-Z-]+$/.test(segment) ||
          /^\[[.a-zA-Z-]+\]$/.test(segment))) {
      attrs.push({ key: 'http.route', value: { stringValue: route } });
    }
    if (typeof status === 'number' && status >= 500 && status <= 599) {
      attrs.push({ key: 'http.status_code', value: { stringValue: String(status) } });
    }
    const bucketCounts = Array(bounds.length + 1).fill('0');
    bucketCounts[bounds.findIndex(bound => ms <= bound) === -1
      ? bounds.length : bounds.findIndex(bound => ms <= bound)] = '1';
    const endNs = (BigInt(span.endTime[0]) * 1_000_000_000n +
      BigInt(span.endTime[1])).toString();
    dataPoints.push({
      attributes: attrs,
      startTimeUnixNano: (BigInt(span.endTime[0]) * 1_000_000_000n +
        BigInt(span.endTime[1]) - BigInt(Math.round(ms * 1e6))).toString(),
      timeUnixNano: endNs,
      count: '1',
      sum: ms,
      explicitBounds: bounds,
      bucketCounts,
      min: ms,
      max: ms,
    });
  }
  if (!dataPoints.length) return null;
  return {
    resourceMetrics: [{
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'idoc.club' } }] },
      scopeMetrics: [{
        scope: { name: 'idoc.nextjs.http-server-span-metrics' },
        metrics: [{
          name: 'http.server.duration',
          description: 'HTTP server request duration from existing Next.js server spans',
          unit: 'ms',
          histogram: { aggregationTemporality: 1, dataPoints },
        }],
      }],
    }],
  };
}

export async function sendServerDurationMetrics(
  spans: readonly ServerSpan[], apiKey: string,
  send: typeof fetch = fetch,
): Promise<void> {
  const payload = serverDurationMetricPayload(spans);
  if (!payload) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await send('https://otlp.nr-data.net/v1/metrics', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) console.warn('[idoc.otel] metric export failed', { status: response.status });
  } catch {
    console.warn('[idoc.otel] metric export unavailable');
  } finally {
    clearTimeout(timer);
  }
}
