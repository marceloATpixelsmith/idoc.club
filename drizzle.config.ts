import type { Config } from 'drizzle-kit';
import { getPostgresConnectionUrl } from './lib/db/connection-url';

export default {
  schema: './lib/db/schema.ts',
  out: './lib/db/migrations',
  dialect: 'postgresql',
  schemaFilter: ['idoc'],
  dbCredentials: {
    url: getPostgresConnectionUrl(),
  },
} satisfies Config;
