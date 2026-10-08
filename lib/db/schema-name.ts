/** Explicit PostgreSQL schema selector. Defaults to the legacy schema until cutover. */
export function getDatabaseSchemaName() {
  const name = process.env.DB_SCHEMA || 'idoc';
  if (!['idoc', 'idoc_staging', 'idoc_production'].includes(name)) throw new Error('Unexpected DB_SCHEMA value');
  const env = process.env.VERCEL_ENV;
  if (env === 'production' && name === 'idoc_staging') throw new Error('Production may not use staging schema');
  if (env === 'preview' && name === 'idoc_production') throw new Error('Staging may not use production schema');
  return name;
}
