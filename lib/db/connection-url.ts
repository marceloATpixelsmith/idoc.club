import { databaseUrlForServer } from '@/lib/runtime/configuration';
import { validateTestDatabaseUrl } from './test-database-url';

export function getPostgresConnectionUrl(): string {
  const connectionUrl = process.env.NODE_ENV === 'test'
    ? validateTestDatabaseUrl(process.env.TEST_DATABASE_URL).toString()
    : databaseUrlForServer();

  const parsedUrl = new URL(connectionUrl);
  const hostname = parsedUrl.hostname.replace(/^\[|\]$/g, '');
  const isLocalDatabase =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1';

  //REQUIRE ENCRYPTION FOR REMOTE DATABASE CONNECTIONS, INCLUDING RENDER.
  if (!isLocalDatabase && !parsedUrl.searchParams.has('sslmode')) {
    parsedUrl.searchParams.set('sslmode', 'require');
  }

  return parsedUrl.toString();
}
