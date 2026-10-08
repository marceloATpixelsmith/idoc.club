/**
 * Read-only schema-isolation inventory. Does not mutate or print member data.
 * Usage: POSTGRES_URL=<existing database URL> node scripts/preflight-schema-isolation.mjs
 * Intended for controlled operator review before any rename or clone.
 */
import postgres from 'postgres';

const url = process.env.POSTGRES_URL;
if (!url) throw new Error('POSTGRES_URL must be present; do not paste credentials in logs.');
const db = postgres(url, { max: 1, connect_timeout: 10, idle_timeout: 1 });
try {
  await db.begin(async (tx) => {
    await tx.unsafe('SET TRANSACTION READ ONLY');
    const names = ['idoc', 'idoc_production', 'idoc_staging'];
    const summary = await tx`
      SELECT n.nspname AS schema, c.relkind, count(*)::int AS objects
      FROM pg_namespace n JOIN pg_class c ON c.relnamespace = n.oid
      WHERE n.nspname IN ${tx(names)}
        AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
      GROUP BY n.nspname, c.relkind ORDER BY n.nspname, c.relkind
    `;
    const relations = await tx`
      SELECT n.nspname AS schema, c.relname AS name, c.relkind,
             pg_total_relation_size(c.oid)::bigint AS bytes
      FROM pg_namespace n JOIN pg_class c ON c.relnamespace = n.oid
      WHERE n.nspname IN ${tx(names)} AND c.relkind IN ('r', 'p', 'S')
      ORDER BY n.nspname, c.relname
    `;
    const schemaDependencies = await tx`
      SELECT source_ns.nspname AS source_schema, target_ns.nspname AS target_schema,
             count(*)::int AS references
      FROM pg_depend d
      JOIN pg_class source_obj ON source_obj.oid = d.objid
      JOIN pg_namespace source_ns ON source_ns.oid = source_obj.relnamespace
      JOIN pg_class target_obj ON target_obj.oid = d.refobjid
      JOIN pg_namespace target_ns ON target_ns.oid = target_obj.relnamespace
      WHERE source_ns.nspname IN ${tx(names)}
        AND target_ns.nspname IN ${tx(names)}
        AND source_ns.nspname <> target_ns.nspname
      GROUP BY source_ns.nspname, target_ns.nspname
    `;
    console.log(JSON.stringify({ readOnly: true, schemaSummary: summary, relations, crossSchemaDependencies: schemaDependencies }, null, 2));
  });
} finally {
  await db.end({ timeout: 2 });
}
