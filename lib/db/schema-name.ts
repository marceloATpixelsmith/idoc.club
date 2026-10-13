/** Explicit PostgreSQL schema selector. Defaults to the legacy schema until cutover. */
export function getDatabaseSchemaName() {
  const env = process.env.VERCEL_ENV;
  // A missing DB_SCHEMA must never fall back to the legacy `idoc` schema in a deployed environment that has a real schema:
  // a Production deployment built before the variable existed ran for hours against a schema that does not exist.
  // Failing here also fails the build, so the previous healthy deployment stays live.
  if (!process.env.DB_SCHEMA && (env === 'production' || (env === 'preview' && process.env.VERCEL_GIT_COMMIT_REF === 'staging'))) {
    throw new Error('DB_SCHEMA must be set explicitly for Production and the staging branch');
  }
  const name = process.env.DB_SCHEMA || 'idoc';
  if (!['idoc', 'idoc_staging', 'idoc_production'].includes(name)) throw new Error('Unexpected DB_SCHEMA value');
  if (env === 'production' && name === 'idoc_staging') throw new Error('Production may not use staging schema');
  if (env === 'preview' && name === 'idoc_production') throw new Error('Staging may not use production schema');
  if (env === 'preview' && name === 'idoc_staging' && process.env.VERCEL_GIT_COMMIT_REF !== 'staging') {
    throw new Error('Only the staging branch may use idoc_staging');
  }
  return name;
}
