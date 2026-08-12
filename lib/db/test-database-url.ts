const TEST_DATABASE_NAME = /^(?:idoc_test|idoc_test_[a-z0-9_]+|[a-z0-9_]+_idoc_test)$/;
const PRODUCTION_MARKERS = /(?:^|[._-])(prod|production|live|primary|render)(?:$|[._-])/i;

/** Fail-closed protection shared by every destructive database test entry point. */
export function validateTestDatabaseUrl(value: string | undefined, productionUrl = process.env.POSTGRES_URL): URL {
  if (!value?.trim()) throw new Error('TEST_DATABASE_URL must be explicitly supplied.');
  let candidate: URL;
  try {
    candidate = new URL(value);
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(candidate.protocol) || !candidate.hostname || !candidate.username) {
    throw new Error('TEST_DATABASE_URL must be a complete PostgreSQL URL.');
  }
  const databaseName = decodeURIComponent(candidate.pathname.replace(/^\//, ''));
  if (!databaseName || databaseName.includes('/') || !TEST_DATABASE_NAME.test(databaseName)) {
    throw new Error('Test database name must be idoc_test or use a delimited idoc_test prefix/suffix.');
  }
  const identity = `${candidate.hostname}.${databaseName}`;
  if (PRODUCTION_MARKERS.test(identity) || /contest/i.test(candidate.hostname) || /\.render\.com$/i.test(candidate.hostname)) {
    throw new Error('Production-like database URLs are forbidden.');
  }
  if (productionUrl) {
    try {
      const production = new URL(productionUrl);
      const normalize = (url: URL) => `${url.protocol}//${url.username}@${url.hostname}:${url.port || '5432'}${url.pathname}`;
      if (normalize(candidate) === normalize(production)) throw new Error('TEST_DATABASE_URL matches POSTGRES_URL.');
    } catch (error) {
      if (error instanceof Error && error.message.includes('matches POSTGRES_URL')) throw error;
    }
  }
  return candidate;
}
