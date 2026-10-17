import { notFound } from 'next/navigation';

import { DryRunForm, type LegacyImportActionState } from './legacy-import-forms';
import { requireFreshStepUp } from '@/lib/auth/mfa/step-up';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { db } from '@/lib/db/drizzle';
import { auditLog } from '@/lib/db/schema';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { AuthorizationError, requireSuperAdmin } from '@/lib/membership/authorization';
import { requireCsrfToken } from '@/lib/security/csrf';
import { LegacyImportInputError, legacyImportEnabled, runLegacyDryRun } from '@/lib/legacy-import/dry-run';
import { runStripeReconciliation } from '@/lib/legacy-import/stripe-reconcile';

// TEMPORARY legacy-import tool (docs/03 section 12): delete this folder, lib/legacy-import and its nav entry after launch stabilisation.
const PATH = '/admin/operations/legacy-import';

async function authorize(formData: FormData) {
  await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
  const actor = await requireAccountAccess('administration');
  requireSuperAdmin(actor);
  return actor;
}

async function dryRunAction(_state: LegacyImportActionState, formData: FormData): Promise<LegacyImportActionState> {
  'use server';
  try {
    const actor = await authorize(formData);
    if (!legacyImportEnabled()) return { error: 'The legacy import is switched off in this environment.' };
    const stepUp = await requireFreshStepUp(actor, 'change-security-settings', PATH);
    if (stepUp.required) return { stepUpRequired: true };
    const files: Array<{ name: string; bytes: Uint8Array }> = [];
    for (const field of ['usersFile', 'meprFile']) {
      const file = formData.get(field);
      if (!(file instanceof File) || file.size === 0) return { error: 'Choose both dump files.' };
      files.push({ name: file.name.slice(0, 120), bytes: new Uint8Array(await file.arrayBuffer()) });
    }
    const { plan, ...result } = runLegacyDryRun(files, new Date().toISOString().slice(0, 10));
    result.report.stripeReconciliation = await runStripeReconciliation(plan.members, plan.orphans);
    await db.insert(auditLog).values({
      actorId: actor.id, action: 'admin.legacy_import.dry_run', entityType: 'legacy_import', entityId: result.files.map((file) => file.sha256.slice(0, 12)).join('+'),
      afterJson: { stripeComparison: result.report.stripeReconciliation?.state, legacyUsers: result.report.legacyUsers, importable: result.report.importable, held: result.report.held, files: result.files.map(({ bytes, sha256 }) => ({ bytes, sha256 })) },
    });
    return { result };
  } catch (error) {
    if (error instanceof LegacyImportInputError || error instanceof AuthorizationError || (error instanceof Error && error.name === 'CsrfError')) return { error: error.message };
    return { error: 'The dry run could not be completed safely.' };
  }
}

export default async function LegacyImportPage() {
  const actor = await requireAccountAccess('administration');
  try { requireSuperAdmin(actor); } catch (error) { if (error instanceof AuthorizationError) notFound(); throw error; }
  const enabled = legacyImportEnabled();
  return (
    <main className="space-y-8 px-5 py-8 lg:px-8">
      <header className="space-y-2">
        <p className="eyebrow">Super Admin Operations · temporary</p>
        <h1 className="text-3xl font-semibold text-gold">Legacy member import</h1>
        <p className="max-w-3xl text-muted-foreground">
          Reads the exported WordPress and MemberPress dump files and reports exactly what would be imported: members, memberships, payments and subscriptions only.
          This step is a dry run. It writes nothing, stores nothing and sends no email. Your browser first trims each file to just the four tables it needs, so the rest never leaves your computer. The server reads what it receives in memory and discards it. The report shows counts; each group can be downloaded as a CSV with one row per person (name, email, membership and Stripe details). Password hashes are never included.
        </p>
      </header>
      {enabled ? (
        <section className="space-y-4 rounded-lg border border-border bg-surface/40 p-5">
          <p className="text-sm text-muted-foreground">Needs your authenticator code. Files up to 4 MB in total.</p>
          <DryRunForm action={dryRunAction} />
        </section>
      ) : (
        <section className="rounded-lg border border-amber-400/40 bg-amber-950/20 p-4 text-sm text-amber-200" role="status">
          The legacy import is switched off in this environment. It is turned on only while a migration run is being prepared (server setting <code>LEGACY_IMPORT_ENABLED=true</code>).
        </section>
      )}
    </main>
  );
}
