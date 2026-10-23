import postgres from 'postgres';
import { createHmac } from 'node:crypto';
import { hash as bcryptHash } from 'bcryptjs';
import { passwordSchema } from '../lib/auth/password-policy.ts';
import { requireDisposableTestEmail, validateStagingDatabaseUrl } from '../lib/db/staging-database-url.ts';

// Seed only disposable, isolated staging identities with real WordPress bcrypt hashes.
// Never replace an existing account or touch production schema/data.
async function main() {
  const scenarios = [
    { email: requireDisposableTestEmail(process.env.LIVE_AUTH_LEGACY_NONCOMPLIANT_EMAIL), password: 'Legacy1!' },
    { email: requireDisposableTestEmail(process.env.LIVE_AUTH_LEGACY_COMPLIANT_EMAIL), password: process.env.LIVE_AUTH_TEST_PASSWORD || '' },
  ];
  if (scenarios[0].email === scenarios[1].email) throw new Error('Distinct legacy test mailboxes are required.');
  if (passwordSchema.safeParse(scenarios[0].password).success || !passwordSchema.safeParse(scenarios[1].password).success) {
    throw new Error('The legacy fixture passwords do not cover both policy outcomes.');
  }
  const url = validateStagingDatabaseUrl(process.env.STAGING_POSTGRES_URL, true).toString();
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    for (const scenario of scenarios) {
      const prehash = createHmac('sha384', 'wp-sha384').update(scenario.password, 'utf8').digest('base64');
      const legacyHash = `$wp${await bcryptHash(prehash, 4)}`.replace(/^\$wp\$2[ab]\$/, '$wp$2y$');
      await sql.begin(async (tx) => {
        const existing = await tx`select id from idoc_staging.users where lower(email)=lower(${scenario.email}) limit 1`;
        if (existing.length) throw new Error('Refusing to overwrite an existing staging account.');
        const [user] = await tx`insert into idoc_staging.users(email,email_display,password_hash,account_state,role,legacy_password_hash,legacy_password_format)
          values(${scenario.email},${scenario.email},'!legacy-import-no-password-yet','migrated_pending','member',${legacyHash},'wp_bcrypt')
          returning id`;
        const legacyId = -user.id;
        const [profile] = await tx`insert into idoc_staging.profiles(user_id,legacy_wp_user_id,first_name,last_name,address_1,city,state_province,postal_code,country_code)
          values(${user.id},${legacyId},'Legacy','Auth Test','Disposable staging fixture','Guadalajara','Jalisco','44100','MX')
          returning id`;
        await tx`insert into idoc_staging.professional_roles(profile_id,role_type) values(${profile.id},'veterinarian')`;
        await tx`insert into idoc_staging.memberships(profile_id,status,starts_on,valid_until,source)
          values(${profile.id},'active',current_date,current_date+interval '1 year','migration')`;
        await tx`insert into idoc_staging.migration_map(legacy_type,legacy_id,new_entity_id,disposition,confidence)
          values('wp_user',${String(legacyId)},${String(user.id)},'imported','high')`;
      });
    }
    console.log('Seeded two disposable staging WordPress-password scenarios (compliant and noncompliant).');
  } finally {
    await sql.end();
  }
}
await main();
