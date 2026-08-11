import type { Config } from 'drizzle-kit';

export default {
  schema: './lib/db/schema.ts',
  out: './lib/db/migrations',
  dialect: 'postgresql',
  schemaFilter: ['idoc'],
  migrations: {
    schema: 'idoc',
    table: '__drizzle_migrations',
  },
  dbCredentials: {
    url: process.env.POSTGRES_URL!,
  },
} satisfies Config;
