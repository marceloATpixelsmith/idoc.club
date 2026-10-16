import 'server-only';

import { desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { auditLog, users } from '@/lib/db/schema';
import { parseBackupManifest, parseDrillResult, type BackupManifest, type DrillResult } from './backup-results';

const BACKUP_WORKFLOW = 'idoc-r2-backups.yml';
const DRILL_WORKFLOW = 'idoc-restore-drill.yml';
const DEFAULT_REPOSITORY = 'marceloATpixelsmith/idoc.club';

export class BackupToolError extends Error {
  constructor(message: string) { super(message); this.name = 'BackupToolError'; }
}

/** The only credential the web app holds for this tool: a fine-grained GitHub token limited to this repository (Actions read/write only;
 * annotations of this public repository need no extra permission). It cannot reach R2, the database owner login or the backup passphrase. Never logged or returned to the browser. */
function configuration() {
  const token = process.env.GITHUB_BACKUP_TOOL_TOKEN?.trim();
  const repository = process.env.GITHUB_BACKUP_TOOL_REPOSITORY?.trim() || DEFAULT_REPOSITORY;
  if (!token) throw new BackupToolError('The backup tool is not configured: set GITHUB_BACKUP_TOOL_TOKEN for this deployment (see docs/16).');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new BackupToolError('GITHUB_BACKUP_TOOL_REPOSITORY is invalid.');
  return { token, repository };
}

async function github(path: string, init: RequestInit = {}): Promise<Response> {
  const { token, repository } = configuration();
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    ...init, cache: 'no-store', signal: AbortSignal.timeout(10_000),
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...init.headers },
  });
  if (response.status === 401 || response.status === 403) throw new BackupToolError('GitHub rejected the backup tool token. Check its permissions and expiry.');
  if (response.status === 404) throw new BackupToolError('GitHub could not find the repository or workflow. Check the token scope and that the workflow is on main.');
  if (!response.ok && response.status !== 204) throw new BackupToolError(`GitHub returned an unexpected status (${response.status}).`);
  return response;
}

type RawRun = { id: number; status: string; conclusion: string | null; created_at: string; updated_at: string; html_url: string; run_number: number };

async function listRuns(workflow: string, limit: number, success?: boolean): Promise<RawRun[]> {
  const query = new URLSearchParams({ per_page: String(limit), ...(success ? { status: 'success' } : {}) });
  const body = await (await github(`/actions/workflows/${workflow}/runs?${query}`)).json() as { workflow_runs?: RawRun[] };
  return Array.isArray(body.workflow_runs) ? body.workflow_runs : [];
}

/** The first job's annotations of one run, filtered to the notice with the given title. */
async function runAnnotation(runId: number, title: string): Promise<string | null> {
  const jobs = await (await github(`/actions/runs/${runId}/jobs?per_page=5`)).json() as { jobs?: Array<{ id: number }> };
  for (const job of jobs.jobs ?? []) {
    const annotations = await (await github(`/check-runs/${job.id}/annotations?per_page=50`)).json() as Array<{ title?: string; message?: string }>;
    const found = Array.isArray(annotations) ? annotations.find((item) => item.title === title && typeof item.message === 'string') : undefined;
    if (found?.message) return found.message;
  }
  return null;
}

export type BackupEntry = { runUrl: string; manifest: BackupManifest };
export async function listBackups(limit = 10): Promise<BackupEntry[]> {
  const runs = await listRuns(BACKUP_WORKFLOW, limit, true);
  const entries = await Promise.all(runs.map(async (run) => {
    const message = await runAnnotation(run.id, 'idoc-backup-manifest').catch(() => null);
    const manifest = message ? parseBackupManifest(message) : null;
    return manifest ? { runUrl: run.html_url, manifest } : null;
  }));
  return entries.filter((entry): entry is BackupEntry => entry !== null);
}

export type DrillRunEntry = { id: number; runNumber: number; state: 'queued' | 'running' | 'completed' | 'failed'; startedAt: string; runUrl: string; result: DrillResult | null };
export async function listDrillRuns(limit = 8): Promise<DrillRunEntry[]> {
  const runs = await listRuns(DRILL_WORKFLOW, limit);
  return Promise.all(runs.map(async (run) => {
    const completed = run.status === 'completed';
    const message = completed ? await runAnnotation(run.id, 'idoc-restore-result').catch(() => null) : null;
    const state = !completed ? (run.status === 'queued' ? 'queued' : 'running') : run.conclusion === 'success' ? 'completed' : 'failed';
    return { id: run.id, runNumber: run.run_number, state, startedAt: run.created_at, runUrl: run.html_url, result: message ? parseDrillResult(message) : null };
  }));
}

export async function dispatchRestoreDrill(selection: string): Promise<void> {
  await github(`/actions/workflows/${DRILL_WORKFLOW}/dispatches`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: 'main', inputs: { backup: selection } }),
  });
}

export async function recordDrillRequest(actorId: number, selection: string): Promise<void> {
  await db.insert(auditLog).values({
    actorId, action: 'admin.restore_drill.requested', entityType: 'restore_drill', entityId: selection === 'latest' ? 'latest' : selection.slice(0, 100),
    afterJson: { selection },
  });
}

export async function listDrillRequests(limit = 8) {
  const rows = await db.select({ id: auditLog.id, createdAt: auditLog.createdAt, selection: auditLog.entityId, actorId: auditLog.actorId })
    .from(auditLog).where(eq(auditLog.action, 'admin.restore_drill.requested')).orderBy(desc(auditLog.createdAt)).limit(limit);
  const ids = [...new Set(rows.map((row) => row.actorId).filter((id): id is number => id !== null))];
  const names = ids.length ? await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, ids)) : [];
  const byId = new Map(names.map((row) => [row.id, row.email]));
  return rows.map((row) => ({ id: row.id, createdAt: row.createdAt, selection: row.selection, by: row.actorId ? byId.get(row.actorId) ?? 'unknown' : 'system' }));
}
