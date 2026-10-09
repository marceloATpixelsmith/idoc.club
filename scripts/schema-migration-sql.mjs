const ALLOWED_SCHEMAS = new Set(['idoc', 'idoc_production', 'idoc_staging']);

export function rewriteMigrationSql(source, targetSchema)
{
    if (!ALLOWED_SCHEMAS.has(targetSchema))
    {
        throw new Error(`Unsupported migration schema: ${targetSchema}`);
    }

    const quotedTarget = `"${targetSchema}"`;
    let rewritten = source
        .replaceAll('CREATE SCHEMA IF NOT EXISTS "idoc"', `CREATE SCHEMA IF NOT EXISTS ${quotedTarget}`)
        .replaceAll('CREATE SCHEMA "idoc"', `CREATE SCHEMA ${quotedTarget}`)
        .replaceAll('"idoc".', `${quotedTarget}.`)
        .replace(/\bidoc\.(?!club\b|allow_member_permanent_delete\b)(?=[a-z_][a-z_0-9]*\b)/gi, `${targetSchema}.`);

    if (targetSchema !== 'idoc' && /"idoc"\s*\./.test(rewritten))
    {
        throw new Error('Migration rewrite left a legacy quoted idoc schema qualifier.');
    }

    return rewritten;
}
