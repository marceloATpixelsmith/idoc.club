import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import dotenv from 'dotenv';
import { getApplicationPostgresConnectionUrl } from './connection-url';
import { getDatabaseSchemaName } from './schema-name';
import 'server-only';

dotenv.config();

let connection: ReturnType<typeof postgres> | undefined;
let database: ReturnType<typeof drizzle<typeof schema>> | undefined;
//LIMIT CONNECTIONS PER VERCEL INSTANCE SO LIGHT TRAFFIC AND BACKGROUND JOBS CANNOT
//ACCUMULATE TEN PERSISTENT POSTGRES BACKENDS PER SERVERLESS INSTANCE.
//RETIRE IDLE CONNECTIONS AND PERIODICALLY ROTATE LONG-LIVED CONNECTIONS.
//KEEP AN IDLE CONNECTION LONGER THAN THE GAP BETWEEN ORDINARY REQUESTS AND MONITOR PROBES: EVERY NEW CONNECTION PAYS A TCP,
//TLS AND PASSWORD HANDSHAKE TO RENDER (A BARE `select 1` HEALTH CHECK MEASURED ABOUT 0.6 S WHEN CONNECTIONS WERE DROPPED AFTER 20 S IDLE).
//THE CAP OF TWO PER INSTANCE STILL BOUNDS THE TOTAL.
//LABEL CONNECTIONS SO RENDER CAN ATTRIBUTE THEM TO IDOC DURING INCIDENT ANALYSIS.
const CONNECTION_OPTIONS = {
  max: 2,
  idle_timeout: 120,
  max_lifetime: 1800,
  connect_timeout: 10,
  connection: { application_name: 'idoc-club', search_path: getDatabaseSchemaName() },
} as const;

function getClient() {
  if (!connection) {
    const pooled = process.env.POSTGRES_POOL_ENABLED === 'true' && process.env.NODE_ENV !== 'test' && !process.env.TEST_DATABASE_URL;
    //TRANSACTION POOLING MUST NOT USE SESSION-LEVEL SET OR NAMED PREPARED STATEMENTS.
    //THE DATABASE ROLE ALREADY HAS THE CORRECT SEARCH_PATH DEFAULT IN POSTGRESQL.
    connection = postgres(getApplicationPostgresConnectionUrl(), pooled
      ? { ...CONNECTION_OPTIONS, prepare: false, connection: { application_name: 'idoc-club' } }
      : CONNECTION_OPTIONS);
  }
  return connection;
}
function getDatabase() { database ??= drizzle(getClient(), { schema }); return database; }
// `client` must remain callable as a tagged template (`client\`select ...\``), matching the real
// postgres.js client it lazily wraps: a Proxy is only callable if its own target is callable, so the
// target here is a stub function (never itself invoked) rather than a plain object, and `apply`
// forwards the call to the real, lazily-created client.
export const client = new Proxy(function client() {} as unknown as ReturnType<typeof postgres>, {
  apply: (_target, thisArg, args) => Reflect.apply(getClient() as unknown as (...values: unknown[]) => unknown, thisArg, args),
  get: (_target, property) => Reflect.get(getClient(), property),
});
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, { get: (_target, property) => Reflect.get(getDatabase(), property) });
