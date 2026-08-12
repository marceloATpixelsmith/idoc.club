import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';
import { validateTestDatabaseUrl } from '@/lib/db/test-database-url';
import type { Actor } from './authorization';

export type ProfileTransactionStage =
  | 'account-state-transition'
  | 'audit-insertion'
  | 'notification-insertion'
  | 'profile-history-insertion'
  | 'profile-write'
  | 'role-closure'
  | 'role-insertion';

type TestBoundary = { actor: Actor; failAt?: ProfileTransactionStage };
const boundary = new AsyncLocalStorage<TestBoundary>();

function assertIsolatedTestProcess(): void {
  if (process.env.NODE_ENV !== 'test' || !process.env.TEST_DATABASE_URL) {
    throw new Error('The membership test boundary is available only to isolated PostgreSQL tests.');
  }
  validateTestDatabaseUrl(process.env.TEST_DATABASE_URL);
}

/** Runs real server data-access code with a server-resolved actor in isolated tests. */
export function withTestMembershipBoundary<T>(
  value: TestBoundary,
  operation: () => Promise<T>,
): Promise<T> {
  assertIsolatedTestProcess();
  return boundary.run(value, operation);
}

export function testBoundaryActor(): Actor | undefined {
  return boundary.getStore()?.actor;
}

export function injectProfileTransactionFailure(stage: ProfileTransactionStage): void {
  if (boundary.getStore()?.failAt === stage) {
    throw new Error(`Injected profile transaction failure at ${stage}.`);
  }
}
