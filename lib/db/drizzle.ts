import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import dotenv from 'dotenv';
import { getPostgresConnectionUrl } from './connection-url';
import 'server-only';

dotenv.config();

let connection: ReturnType<typeof postgres> | undefined;
let database: ReturnType<typeof drizzle<typeof schema>> | undefined;
function getClient() { connection ??= postgres(getPostgresConnectionUrl()); return connection; }
function getDatabase() { database ??= drizzle(getClient(), { schema }); return database; }
export const client = new Proxy({} as ReturnType<typeof postgres>, { get: (_target, property) => Reflect.get(getClient(), property) });
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, { get: (_target, property) => Reflect.get(getDatabase(), property) });
