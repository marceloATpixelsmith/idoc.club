import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';
import { cookies } from 'next/headers';
import { validateTestDatabaseUrl } from '@/lib/db/test-database-url';

type CookieValue = { name: string; value: string };
export type MutableCookieStore = {
  delete(name: string): void;
  get(name: string): CookieValue | undefined;
  set(name: string, value: string, options?: Record<string, unknown>): void;
};

type TestRequest = { cookies: MutableCookieStore; environment?: NodeJS.ProcessEnv; origin: string };
const testStore = new AsyncLocalStorage<TestRequest>();

function assertIsolatedTestProcess() {
  if (process.env.NODE_ENV !== 'test' || !process.env.TEST_DATABASE_URL) {
    throw new Error('The request-cookie test boundary is available only to isolated PostgreSQL tests.');
  }
  validateTestDatabaseUrl(process.env.TEST_DATABASE_URL);
}

/** Production-equivalent cookie access with an isolated request adapter for database integration tests. */
export async function requestCookies(): Promise<MutableCookieStore> {
  return testStore.getStore()?.cookies ?? await cookies();
}

export function withTestRequestCookies<T>(
  store: MutableCookieStore,
  operation: () => Promise<T>,
  origin = '127.0.0.1',
  environment?: NodeJS.ProcessEnv,
): Promise<T> {
  assertIsolatedTestProcess();
  return testStore.run({ cookies: store, environment, origin }, operation);
}

export function testRequestOrigin(): string | undefined {
  return testStore.getStore()?.origin;
}

/** Isolated runtime-environment override used to exercise production cookie semantics without
 * weakening the real production path or changing the integration test process out of NODE_ENV=test. */
export function testRequestEnvironment(): NodeJS.ProcessEnv | undefined {
  return testStore.getStore()?.environment;
}
