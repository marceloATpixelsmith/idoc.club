import { notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { DrillForm, MaintenanceForm, type BackupsActionState } from './backups-forms';
import { requireFreshStepUp } from '@/lib/auth/mfa/step-up';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { AuthorizationError, requireSuperAdmin } from '@/lib/membership/authorization';
import { requireCsrfToken } from '@/lib/security/csrf';
import { readMaintenanceState, setMaintenanceMode } from '@/lib/admin/maintenance-mode';
import { BackupToolError, dispatchRestoreDrill, listBackups, listDrillRequests, listDrillRuns, recordDrillRequest, type BackupEntry, type DrillRunEntry } from '@/lib/admin/backup-tool';
import { drillIsFullPass, parseBackupSelection } from '@/lib/admin/backup-results';
import { formatTableDate } from '@/lib/format';

const PATH = '/admin/operations/backups';

async function authorize(formData: FormData) {
  await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
  const actor = await requireAccountAccess('administration');
  requireSuperAdmin(actor);
  return actor;
}

function actionError(error: unknown): BackupsActionState {
  if (error instanceof BackupToolError || error instanceof AuthorizationError || (error instanceof Error && error.name === 'CsrfError')) return { error: error.message };
  return { error: 'The action could not be completed safely.' };
}

async function maintenanceAction(_state: BackupsActionState, formData: FormData): Promise<BackupsActionState> {
  'use server';
  try {
    const actor = await authorize(formData);
    const stepUp = await requireFreshStepUp(actor, 'change-security-settings', PATH);
    if (stepUp.required) return { stepUpRequired: true };
    const enabled = formData.get('enabled') === 'on';
    const reason = typeof formData.get('reason') === 'string' ? String(formData.get('reason')) : null;
    await setMaintenanceMode(actor.id, enabled, reason);
    revalidatePath(PATH);
    return { success: enabled ? 'Maintenance mode is ON. Visitors now see the maintenance page.' : 'Maintenance mode is OFF. The site is live again.' };
  } catch (error) {
    return actionError(error);
  }
}

async function drillAction(_state: BackupsActionState, formData: FormData): Promise<BackupsActionState> {
  'use server';
  try {
    const actor = await authorize(formData);
    const selection = parseBackupSelection(formData.get('selection'));
    if (!selection) return { error: 'Choose the latest backup or one from the list.' };
    const stepUp = await requireFreshStepUp(actor, 'change-security-settings', PATH);
    if (stepUp.required) return { stepUpRequired: true };
    await recordDrillRequest(actor.id, selection);
    await dispatchRestoreDrill(selection);
    revalidatePath(PATH);
    return { success: 'Restore drill started. It takes a few minutes; refresh this page to see the result. It never touches the live database.' };
  } catch (error) {
    return actionError(error);
  }
}

function backupTime(stamp: string) {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(stamp);
  return match ? `${formatTableDate(`${match[1]}-${match[2]}-${match[3]}`)} ${match[4]}:${match[5]} UTC` : stamp;
}
const megabytes = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;

export default async function BackupsPage() {
  const actor = await requireAccountAccess('administration');
  try { requireSuperAdmin(actor); } catch (error) { if (error instanceof AuthorizationError) notFound(); throw error; }

  const maintenance = await readMaintenanceState();
  let backups: BackupEntry[] = [];
  let drills: DrillRunEntry[] = [];
  let configurationError: string | null = null;
  try {
    [backups, drills] = await Promise.all([listBackups(), listDrillRuns()]);
  } catch (error) {
    configurationError = error instanceof BackupToolError ? error.message : 'GitHub could not be reached. Try again shortly.';
  }
  const requests = await listDrillRequests();
  const newest = backups[0]?.manifest;
  const options = backups.map(({ manifest }) => ({ value: manifest.object, label: `${manifest === newest ? 'Latest — ' : ''}${manifest.kind === 'daily' ? 'Daily' : 'Pre-migration'} ${backupTime(manifest.startedAtUtc)} (${megabytes(manifest.sizeBytes)})` }));

  return (
    <main className="space-y-8 px-5 py-8 lg:px-8">
      <header className="space-y-2">
        <p className="eyebrow">Super Admin Operations</p>
        <h1 className="text-3xl font-semibold text-gold">Backups &amp; Restore</h1>
        <p className="max-w-3xl text-muted-foreground">
          Nightly encrypted backups of both IDOC schemas are stored offsite. A restore drill proves a backup can really be restored by rebuilding it in a
          throwaway database and comparing every table&rsquo;s row count with the count taken when the backup was made. Drills never change live data.
        </p>
      </header>

      <section className={`space-y-4 rounded-lg border p-5 ${maintenance.enabled ? 'border-amber-400/60 bg-amber-950/20' : 'border-border bg-surface/40'}`}>
        <div>
          <h2 className="text-lg font-semibold text-foreground">Maintenance mode — currently {maintenance.enabled ? 'ON' : 'off'}</h2>
          {maintenance.enabled && maintenance.changedAt ? <p className="text-sm text-amber-200">On since {formatTableDate(maintenance.changedAt)}{maintenance.reason ? ` — ${maintenance.reason}` : ''}</p> : null}
          <p className="text-sm text-muted-foreground">This applies to this environment only (staging and Production are switched separately). You stay signed in and can switch it off here.</p>
        </div>
        <MaintenanceForm action={maintenanceAction} enabled={maintenance.enabled} reason={maintenance.reason ?? ''} />
      </section>

      {configurationError ? (
        <section className="rounded-lg border border-red-400/40 bg-red-950/20 p-4 text-sm text-red-200" role="alert">{configurationError}</section>
      ) : (
        <>
          <section className="space-y-3 rounded-lg border border-border bg-surface/40 p-5">
            <h2 className="text-lg font-semibold text-foreground">Latest backup</h2>
            {newest ? (
              <p className="text-sm text-muted-foreground">{backupTime(newest.startedAtUtc)} · {megabytes(newest.sizeBytes)} · {newest.tableCount} tables · {newest.totalRows.toLocaleString('en-GB')} rows</p>
            ) : (
              <p className="text-sm text-amber-200">No backup with a manifest has been recorded yet. Run “IDOC R2 Schema Backups” in GitHub Actions once, then refresh.</p>
            )}
          </section>

          <section className="space-y-4 rounded-lg border border-border bg-surface/40 p-5">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Run a restore drill</h2>
              <p className="text-sm text-muted-foreground">Needs your authenticator code. The drill downloads the chosen backup, checks its checksum, restores it into a throwaway database and compares row counts.</p>
            </div>
            <DrillForm action={drillAction} disabled={backups.length === 0} options={options} />
          </section>

          <section className="space-y-3 rounded-lg border border-border bg-surface/40 p-5">
            <h2 className="text-lg font-semibold text-foreground">Drill results</h2>
            {drills.length === 0 ? <p className="text-sm text-muted-foreground">No drills yet.</p> : (
              <ul className="space-y-3">
                {drills.map((drill) => {
                  const result = drill.result;
                  const verdict = drill.state === 'queued' || drill.state === 'running' ? 'RUNNING' : result ? (drillIsFullPass(result) ? 'PASS' : 'FAIL') : 'FAILED (no result)';
                  const good = verdict === 'PASS';
                  return (
                    <li className="rounded-md border border-border p-3 text-sm" key={drill.id}>
                      <p className="font-semibold"><span className={good ? 'text-emerald-300' : verdict === 'RUNNING' ? 'text-amber-200' : 'text-red-300'}>{verdict}</span> · run #{drill.runNumber} · {formatTableDate(drill.startedAt)}{' '}
                        <a className="text-gold underline" href={drill.runUrl} rel="noreferrer" target="_blank">workflow log</a></p>
                      {result ? (
                        <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                          <li>Backup: {result.object ?? 'unknown'}</li>
                          <li>Checksum matched manifest: {result.checksumMatched === null ? 'not checked' : result.checksumMatched ? 'yes' : 'NO'}</li>
                          <li>Tables compared: {result.manifestTables}; schemas restored: {result.schemasRestored.join(', ') || 'none'}</li>
                          <li>Row-count mismatches: {result.rowCountMismatches.length === 0 ? 'none — every table matches' : result.rowCountMismatches.map((m) => `${m.table} (expected ${m.expected ?? 'missing'}, restored ${m.actual ?? 'missing'})`).join('; ')}</li>
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}

      <section className="space-y-3 rounded-lg border border-border bg-surface/40 p-5">
        <h2 className="text-lg font-semibold text-foreground">Who started drills</h2>
        {requests.length === 0 ? <p className="text-sm text-muted-foreground">No drill requests yet.</p> : (
          <ul className="space-y-1 text-sm text-muted-foreground">
            {requests.map((request) => <li key={request.id}>{formatTableDate(request.createdAt)} · {request.by} · {request.selection}</li>)}
          </ul>
        )}
      </section>
    </main>
  );
}
