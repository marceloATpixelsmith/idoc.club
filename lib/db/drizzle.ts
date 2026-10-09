import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import dotenv from 'dotenv';
import { getPostgresConnectionUrl } from './connection-url';
import { getDatabaseSchemaName } from './schema-name';
import 'server-only';

dotenv.config();

let connection: ReturnType<typeof postgres> | undefined;
let database: ReturnType<typeof drizzle<typeof schema>> | undefined;
//LIMIT CONNECTIONS PER VERCEL INSTANCE SO LIGHT TRAFFIC AND BACKGROUND JOBS CANNOT
//ACCUMULATE TEN PERSISTENT POSTGRES BACKENDS PER SERVERLESS INSTANCE.
//RETIRE IDLE CONNECTIONS AND PERIODICALLY ROTATE LONG-LIVED CONNECTIONS.
//LABEL CONNECTIONS SO RENDER CAN ATTRIBUTE THEM TO IDOC DURING INCIDENT ANALYSIS.
const CONNECTION_OPTIONS = {
  max: 2,
  idle_timeout: 20,
  max_lifetime: 300,
  connect_timeout: 10,
  connection: { application_name: 'idoc-club', search_path: getDatabaseSchemaName() },
} as const;

function getClient() { connection ??= postgres(getPostgresConnectionUrl(), CONNECTION_OPTIONS); return connection; }
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
