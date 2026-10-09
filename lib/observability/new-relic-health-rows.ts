// Pure mapping of New Relic NRQL facet results into digest rows (kept import-free so unit tests can load it).

export type HealthRow = { route: string; value: number; requests?: number };

const routeOf = (row: Record<string, unknown>) => (typeof row['http.route'] === 'string' && row['http.route'] ? row['http.route'] : typeof row.facet === 'string' ? row.facet : '(no route)');
const numberOf = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

export function toErrorRows(results: Record<string, unknown>[]): HealthRow[] {
  return results.map((row) => ({ route: routeOf(row), value: numberOf(row.errors) })).filter((row) => row.value > 0);
}

export function toSlowRows(results: Record<string, unknown>[]): HealthRow[] {
  return results.map((row) => {
    const p95 = row.p95;
    const value = numberOf(p95 && typeof p95 === 'object' ? (p95 as Record<string, unknown>)['95'] : p95);
    return { requests: numberOf(row.requests), route: routeOf(row), value };
  }).filter((row) => row.value > 0).sort((a, b) => b.value - a.value);
}
