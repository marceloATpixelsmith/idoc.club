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

    const nonRelationObjects = await tx`
      SELECT n.nspname AS schema, 'function' AS object_type, count(*)::int AS objects
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ${tx(names)}
      GROUP BY n.nspname
      UNION ALL
      SELECT n.nspname, 'constraint', count(*)::int
      FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
      WHERE n.nspname IN ${tx(names)}
      GROUP BY n.nspname
      UNION ALL
      SELECT n.nspname, 'trigger', count(*)::int
      FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ${tx(names)} AND NOT t.tgisinternal
      GROUP BY n.nspname
      ORDER BY 1,2
    `;

    //PG_DEPEND'S OBJID/REFOBJID ARE ONLY MEANINGFUL TOGETHER WITH CLASSID/REFCLASSID.
    //RESOLVE THE NAMESPACE FOR EACH RELEVANT CATALOG TYPE SO FUNCTIONS, CONSTRAINTS,
    //VIEW REWRITE RULES AND TRIGGERS CANNOT SILENTLY ESCAPE THE ISOLATION AUDIT.
    const schemaDependencies = await tx`
      WITH resolved AS (
        SELECT d.*,
          CASE d.classid
            WHEN 'pg_class'::regclass THEN (SELECT relnamespace FROM pg_class WHERE oid=d.objid)
            WHEN 'pg_proc'::regclass THEN (SELECT pronamespace FROM pg_proc WHERE oid=d.objid)
            WHEN 'pg_constraint'::regclass THEN (SELECT connamespace FROM pg_constraint WHERE oid=d.objid)
            WHEN 'pg_rewrite'::regclass THEN (
              SELECT c.relnamespace FROM pg_rewrite r JOIN pg_class c ON c.oid=r.ev_class WHERE r.oid=d.objid
            )
            WHEN 'pg_trigger'::regclass THEN (
              SELECT c.relnamespace FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE t.oid=d.objid
            )
            WHEN 'pg_type'::regclass THEN (SELECT typnamespace FROM pg_type WHERE oid=d.objid)
            WHEN 'pg_namespace'::regclass THEN d.objid
            ELSE NULL
          END AS source_namespace_oid,
          CASE d.refclassid
            WHEN 'pg_class'::regclass THEN (SELECT relnamespace FROM pg_class WHERE oid=d.refobjid)
            WHEN 'pg_proc'::regclass THEN (SELECT pronamespace FROM pg_proc WHERE oid=d.refobjid)
            WHEN 'pg_constraint'::regclass THEN (SELECT connamespace FROM pg_constraint WHERE oid=d.refobjid)
            WHEN 'pg_rewrite'::regclass THEN (
              SELECT c.relnamespace FROM pg_rewrite r JOIN pg_class c ON c.oid=r.ev_class WHERE r.oid=d.refobjid
            )
            WHEN 'pg_trigger'::regclass THEN (
              SELECT c.relnamespace FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE t.oid=d.refobjid
            )
            WHEN 'pg_type'::regclass THEN (SELECT typnamespace FROM pg_type WHERE oid=d.refobjid)
            WHEN 'pg_namespace'::regclass THEN d.refobjid
            ELSE NULL
          END AS target_namespace_oid
        FROM pg_depend d
      )
      SELECT source_ns.nspname AS source_schema,
             target_ns.nspname AS target_schema,
             count(*)::int AS references
      FROM resolved r
      JOIN pg_namespace source_ns ON source_ns.oid=r.source_namespace_oid
      JOIN pg_namespace target_ns ON target_ns.oid=r.target_namespace_oid
      WHERE source_ns.nspname IN ${tx(names)}
        AND target_ns.nspname IN ${tx(names)}
        AND source_ns.nspname <> target_ns.nspname
      GROUP BY source_ns.nspname, target_ns.nspname
      ORDER BY source_ns.nspname, target_ns.nspname
    `;

    //DEPENDENCY CATALOGS CANNOT SEE DYNAMIC SQL EMBEDDED AS FUNCTION TEXT. REPORT ONLY
    //COUNTS/NAMES OF OFFENDING FUNCTIONS; NEVER PRINT FUNCTION BODIES OR MEMBER DATA.
    const textualCrossSchemaReferences = await tx`
      SELECT n.nspname AS source_schema, p.proname AS object_name, 'function' AS object_type
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ${tx(names)}
        AND (
          (n.nspname <> 'idoc_production' AND
            (position('idoc_production.' in pg_get_functiondef(p.oid)) > 0 OR
             position('"idoc_production".' in pg_get_functiondef(p.oid)) > 0))
          OR
          (n.nspname <> 'idoc_staging' AND
            (position('idoc_staging.' in pg_get_functiondef(p.oid)) > 0 OR
             position('"idoc_staging".' in pg_get_functiondef(p.oid)) > 0))
        )
      ORDER BY n.nspname, p.proname
    `;

    console.log(JSON.stringify({
      readOnly: true,
      schemaSummary: summary,
      relations,
      nonRelationObjects,
      crossSchemaDependencies: schemaDependencies,
      textualCrossSchemaReferences,
    }, null, 2));
  });
} finally {
  await db.end({ timeout: 2 });
}
