import type { Config } from 'drizzle-kit';
import { getPostgresConnectionUrl } from './lib/db/connection-url';

export default {
  schema: './lib/db/schema.ts',
  out: './lib/db/migrations',
  dialect: 'postgresql',
  schemaFilter: [process.env.DB_SCHEMA || 'idoc'],
  migrations: {
    schema: process.env.DB_SCHEMA || 'idoc',
    table: '__drizzle_migrations',
  },
  dbCredentials: {
    url: getPostgresConnectionUrl(),
  },
} satisfies Config;
