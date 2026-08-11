import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import dotenv from 'dotenv';
import { getPostgresConnectionUrl } from './connection-url';

dotenv.config();

export const client = postgres(getPostgresConnectionUrl());
export const db = drizzle(client, { schema });
