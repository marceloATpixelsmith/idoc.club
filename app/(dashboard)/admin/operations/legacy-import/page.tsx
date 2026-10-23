import { notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { desc, eq } from 'drizzle-orm';

import { DryRunForm, type LegacyImportActionState } from './legacy-import-forms';
import { requireFreshStepUp } from '@/lib/auth/mfa/step-up';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { db } from '@/lib/db/drizzle';
import { auditLog, users } from '@/lib/db/schema';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { AuthorizationError, requireSuperAdmin } from '@/lib/membership/authorization';
import { requireCsrfToken } from '@/lib/security/csrf';
import { LegacyImportInputError, legacyImportEnabled, runLegacyDryRun } from '@/lib/legacy-import/dry-run';
import { LegacyImportBlockedError, runLegacyImport } from '@/lib/legacy-import/import-run';
import { fetchStripeSnapshot, runStripeReconciliation, type StripeSnapshot } from '@/lib/legacy-import/stripe-reconcile';
import { getDatabaseSchemaName } from '@/lib/db/schema-name';

// TEMPORARY legacy-import tool (docs/03 section 12): delete this folder, lib/legacy-import and its nav entry after launch stabilisation.
const PATH = '/admin/operations/legacy-import';

async function authorize(formData: FormData) {
  await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
  const actor = await requireAccountAccess('administration');
  requireSuperAdmin(actor);
  return actor;
}

async function legacyImportAction(_state: LegacyImportActionState, formData: FormData): Promise<LegacyImportActionState> {
  'use server';
  const importing = formData.get('intent') === 'import';
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
    let snapshot: StripeSnapshot | null = null;
    result.report.stripeReconciliation = await runStripeReconciliation(plan.members, plan.orphans, process.env, async (key, since) => {
      snapshot = await fetchStripeSnapshot(key, since);
      return snapshot;
    });
    if (!importing) {
      await db.insert(auditLog).values({
        actorId: actor.id, action: 'admin.legacy_import.dry_run', entityType: 'legacy_import', entityId: result.files.map((file) => file.sha256.slice(0, 12)).join('+'),
        afterJson: { stripeComparison: result.report.stripeReconciliation?.state, legacyUsers: result.report.legacyUsers, importable: result.report.importable, held: result.report.held, files: result.files.map(({ bytes, sha256 }) => ({ bytes, sha256 })) },
      });
      return { result };
    }
    // The import only ever uses the files that were reviewed: their checksums must match what the dry run showed.
    const reviewed = formData.getAll('reviewedSha').map(String);
    if (reviewed.length !== result.files.length || reviewed.some((sha, index) => sha !== result.files[index].sha256)) {
      return { error: 'These files are not the ones you reviewed in the dry run. Run the dry run again with the same files, then import.' };
    }
    if (formData.get('backupConfirmed') !== 'on') return { error: 'Confirm that a recent verified backup exists before importing.' };
    if (String(formData.get('confirmPhrase') ?? '').trim() !== `IMPORT ${result.report.importable} MEMBERS`) return { error: 'The confirmation text does not match.' };
    if (!snapshot) return { error: 'The comparison with live Stripe did not run, so the import was not started.' };
    const imported = await runLegacyImport({ plan, report: result.report, snapshot, actorId: actor.id, fileFingerprints: result.files.map((file) => file.sha256) });
    revalidatePath(PATH);
    return { imported };
  } catch (error) {
    if (error instanceof LegacyImportInputError || error instanceof LegacyImportBlockedError || error instanceof AuthorizationError || (error instanceof Error && error.name === 'CsrfError')) return { error: error.message };
    return { error: importing ? 'The import failed and was rolled back; nothing was written.' : 'The dry run could not be completed safely.' };
  }
}

export default async function LegacyImportPage() {
  const actor = await requireAccountAccess('administration');
  try { requireSuperAdmin(actor); } catch (error) { if (error instanceof AuthorizationError) notFound(); throw error; }
  const enabled = legacyImportEnabled();
  const history = await db.select({ id: auditLog.id, completedAt: auditLog.createdAt, actorEmail: users.email, details: auditLog.afterJson })
    .from(auditLog).leftJoin(users, eq(users.id, auditLog.actorId))
    .where(eq(auditLog.action, 'admin.legacy_import.import'))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id)).limit(100);
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
          <DryRunForm action={legacyImportAction} environment={getDatabaseSchemaName()} />
        </section>
      ) : (
        <section className="rounded-lg border border-amber-400/40 bg-amber-950/20 p-4 text-sm text-amber-200" role="status">
          The legacy import is switched off in this environment. It is turned on only while a migration run is being prepared (server setting <code>LEGACY_IMPORT_ENABLED=true</code>).
        </section>
      )}
      <section className="space-y-4 rounded-lg border border-border bg-surface/40 p-5" aria-labelledby="successful-legacy-imports-heading">
        <h2 className="text-xl font-semibold text-foreground" id="successful-legacy-imports-heading">Successful Imports</h2>
        <p className="text-sm text-muted-foreground">Completed imports recorded in this environment, newest first. Failed or rolled-back attempts are not shown. Records remain available after refreshing this page.</p>
        {history.length === 0 ? <p className="text-sm text-muted-foreground">No successful imports have been recorded yet.</p> : (
          <ul className="space-y-3">
            {history.map((entry) => {
              const data = entry.details && typeof entry.details === 'object' && !Array.isArray(entry.details)
                ? entry.details as Record<string, unknown> : {};
              const amount = (key: string) => typeof data[key] === 'number' ? (data[key] as number).toLocaleString('en-GB') : '—';
              const fingerprints = Array.isArray(data.files) ? data.files.filter((value): value is string => typeof value === 'string') : [];
              return <li className="rounded-md border border-border p-4" key={entry.id}>
                <details className="group">
                  <summary className="cursor-pointer text-sm font-medium text-foreground">
                    <span className="text-emerald-300">Successful</span> · {entry.completedAt.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC · {amount('imported')} imported · {amount('alreadyImported')} previously imported
                  </summary>
                  <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                    <p>Run #{entry.id} · Performed by {entry.actorEmail ?? 'Administrator account no longer available'} · Schema: {typeof data.schema === 'string' ? data.schema : 'Unknown'}</p>
                    <p>Payments: {amount('payments')} · Refunds: {amount('refunds')} · Subscriptions: {amount('subscriptions')} · Billing accounts: {amount('billingAccounts')}</p>
                    <p>Zero-amount payments skipped: {amount('skippedZeroAmountPayments')} · Members without storable subscriptions: {amount('membersWithoutStorableSubscription')}</p>
                    <p>Existing accounts skipped: {amount('skippedExistingAccounts')} · Existing billing references skipped: {amount('skippedExistingBillingReferences')} · Ambiguous source billing references skipped: {amount('skippedAmbiguousBillingReferences')}</p>
                    {Array.isArray(data.skippedExistingAccountDetails) && data.skippedExistingAccountDetails.length > 0 ? (
                      <div className="space-y-1">
                        <p className="font-medium text-foreground">Existing accounts preserved and skipped:</p>
                        <ul className="list-disc space-y-1 pl-5">
                          {data.skippedExistingAccountDetails.map((item, index) => {
                            if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
                            const detail = item as Record<string, unknown>;
                            return <li className="break-words" key={index}>Legacy user {String(detail.legacyUserId ?? '?')} ({String(detail.email ?? '?')}) — {String(detail.existingAccount ?? 'Existing account')}</li>;
                          })}
                        </ul>
                      </div>
                    ) : null}
                    {Array.isArray(data.skippedAmbiguousBillingReferenceDetails) && data.skippedAmbiguousBillingReferenceDetails.length > 0 ? (
                      <div className="space-y-1">
                        <p className="font-medium text-foreground">Legacy members skipped due to ambiguous Stripe ownership:</p>
                        <ul className="list-disc space-y-1 pl-5">
                          {data.skippedAmbiguousBillingReferenceDetails.map((item, index) => {
                            if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
                            const detail = item as Record<string, unknown>;
                            return <li className="break-words" key={index}>Legacy user {String(detail.legacyUserId ?? '?')} ({String(detail.email ?? '?')}) — shared Stripe reference</li>;
                          })}
                        </ul>
                      </div>
                    ) : null}
                    {fingerprints.length > 0 ? <p className="break-all">Source file SHA-256 fingerprints: {fingerprints.join(', ')}</p> : null}
                  </div>
                </details>
              </li>;
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
