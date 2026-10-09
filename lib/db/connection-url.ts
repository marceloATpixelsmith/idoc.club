import { databaseUrlForServer } from '@/lib/runtime/configuration';
import { validateTestDatabaseUrl } from './test-database-url';
import { getDatabaseSchemaName } from './schema-name';

export function getPostgresConnectionUrl(): string {
  const connectionUrl = (process.env.NODE_ENV === 'test' || Boolean(process.env.TEST_DATABASE_URL))
    ? validateTestDatabaseUrl(process.env.TEST_DATABASE_URL).toString()
    : databaseUrlForServer();

  const parsedUrl = new URL(connectionUrl);
  const activeSchema = getDatabaseSchemaName();
  const deploymentEnvironment = process.env.VERCEL_ENV;
  if (process.env.NODE_ENV !== 'test' && (deploymentEnvironment === 'production' || deploymentEnvironment === 'preview')) {
    const requiredLogin = activeSchema === 'idoc_production' ? 'idoc_production_app'
      : activeSchema === 'idoc_staging' ? 'idoc_staging_app' : null;
    if (requiredLogin && decodeURIComponent(parsedUrl.username) !== requiredLogin) {
      throw new Error('The PostgreSQL login is not authorized for the selected environment schema.');
    }
  }
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
