import type { Config } from 'drizzle-kit';
import { getDatabaseSchemaName } from './lib/db/schema-name';
import { getPostgresConnectionUrl } from './lib/db/connection-url';

export default {
  schema: './lib/db/schema.ts',
  out: './lib/db/migrations',
  dialect: 'postgresql',
  schemaFilter: [getDatabaseSchemaName()],
  migrations: {
    schema: process.env.DB_SCHEMA || 'idoc',
    table: '__drizzle_migrations',
  },
  dbCredentials: {
    url: getPostgresConnectionUrl(),
  },
} satisfies Config;
