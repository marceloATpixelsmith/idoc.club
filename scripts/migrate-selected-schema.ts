import 'server-only';

import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { getPostgresConnectionUrl } from '../lib/db/connection-url';
import { getDatabaseSchemaName } from '../lib/db/schema-name';
import { rewriteMigrationSql } from './schema-migration-sql.mjs';

async function rewriteSqlFiles(directory: string, targetSchema: string): Promise<void>
{
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries)
    {
        const entryPath = path.join(directory, entry.name);

        if (entry.isDirectory())
        {
            await rewriteSqlFiles(entryPath, targetSchema);
            continue;
        }

        if (!entry.isFile() || path.extname(entry.name) !== '.sql')
        {
            continue;
        }

        const source = await readFile(entryPath, 'utf8');
        await writeFile(entryPath, rewriteMigrationSql(source, targetSchema), 'utf8');
    }
}

async function main(): Promise<void>
{
    const schemaName = getDatabaseSchemaName();
    const sourceDirectory = path.resolve('lib/db/migrations');
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'idoc-drizzle-migrations-'));
    const migrationDirectory = path.join(temporaryRoot, 'migrations');
    const connection = postgres(getPostgresConnectionUrl(), {
        max: 1,
        connection: {
            application_name: 'idoc-club-migrator',
            search_path: schemaName,
        },
    });

    try
    {
        await cp(sourceDirectory, migrationDirectory, { recursive: true });
        await rewriteSqlFiles(migrationDirectory, schemaName);

        const db = drizzle(connection);
        await migrate(db, {
            migrationsFolder: migrationDirectory,
            migrationsSchema: schemaName,
            migrationsTable: '__drizzle_migrations',
        });
    }
    finally
    {
        await connection.end({ timeout: 5 });
        await rm(temporaryRoot, { force: true, recursive: true });
    }

}

main().catch((error: unknown) =>
{
    console.error(error);
    process.exitCode = 1;
});
