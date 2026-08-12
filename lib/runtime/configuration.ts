const BUILD_PHASE = 'phase-production-build';
const BUILD_DATABASE_URL = 'postgres://build:build@127.0.0.1:5432/idoc_build';
const BUILD_STRIPE_KEY = 'sk_test_build_time_placeholder';

type Environment = Partial<Record<string, string | undefined>>;

function isProductionBuild(environment: Environment) {
  return environment.NEXT_PHASE === BUILD_PHASE;
}

export function databaseUrlForServer(environment: Environment = process.env) {
  const value = environment.POSTGRES_URL;
  if (value) return value;
  if (isProductionBuild(environment)) return BUILD_DATABASE_URL;
  throw new Error('POSTGRES_URL environment variable is not set');
}

export function stripeKeyForServer(environment: Environment = process.env) {
  const value = environment.STRIPE_SECRET_KEY;
  if (value) return value;
  if (isProductionBuild(environment)) return BUILD_STRIPE_KEY;
  throw new Error('STRIPE_SECRET_KEY environment variable is not set');
}
