/** Shared, dependency-free constant so `middleware.ts` (edge/node middleware runtime) and
 * `lib/observability/request-id.ts` (server-only, uses `next/headers`) can agree on the header name
 * without either importing the other's runtime-specific code. */
export const REQUEST_ID_HEADER = 'x-request-id';
