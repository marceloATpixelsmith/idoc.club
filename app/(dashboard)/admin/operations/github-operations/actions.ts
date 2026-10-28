'use server';
import { revalidatePath } from 'next/cache';
import { and, eq, gt, sql } from 'drizzle-orm';
import { requireFreshStepUp } from '@/lib/auth/mfa/step-up';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { AuthorizationError, requireSuperAdmin } from '@/lib/membership/authorization';
import { requireCsrfToken } from '@/lib/security/csrf';
import { db } from '@/lib/db/drizzle';
import { auditLog } from '@/lib/db/schema';
import { dispatchManualGithubOperation, isManualGithubWorkflow, listManualGithubOperationRuns, MANUAL_GITHUB_WORKFLOWS, ManualGithubOperationsError, type ManualGithubWorkflow } from '@/lib/admin/manual-github-operations';
import type { ManualGithubOperationActionState } from './manual-github-operation-form';
async function authorize(formData: FormData) {
  await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
  const actor = await requireAccountAccess('administration');
  requireSuperAdmin(actor);
  return actor;
}

async function reserveRequest(actorId: number, workflow: ManualGithubWorkflow): Promise<boolean> {
  const action = 'admin.github_operation.requested';
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`idoc-manual-github-${workflow}`}))`);
    const [recent] = await tx.select({ id: auditLog.id }).from(auditLog)
      .where(and(
        eq(auditLog.action, action),
        eq(auditLog.entityId, workflow),
        gt(auditLog.createdAt, sql`now() - interval '2 minutes'`),
      )).limit(1);
    if (recent) return false;
    await tx.insert(auditLog).values({
      actorId,
      action,
      entityType: 'github_workflow',
      entityId: workflow,
      afterJson: { ref: 'staging', workflowFile: MANUAL_GITHUB_WORKFLOWS[workflow].file },
    });
    return true;
  });
}

export async function runOperationAction(
  _state: ManualGithubOperationActionState,
  formData: FormData,
): Promise<ManualGithubOperationActionState> {
  try {
    const actor = await authorize(formData);
    const value = formData.get('workflow');
    if (!isManualGithubWorkflow(value)) return { error: 'Choose one of the available GitHub operations.' };
    const returnTo = value === 'production-promotion' ? '/admin/operations/production-promotion' : '/admin/operations/live-auth-tests';
    const stepUp = await requireFreshStepUp(actor, 'change-security-settings', returnTo);
    if (stepUp.required) return { stepUpRequired: true };

    const active = (await listManualGithubOperationRuns()).some((run) =>
      (run.workflow === value || (value === 'production-promotion' && run.workflow === 'production-recovery')) && (run.status === 'queued' || run.status === 'in_progress'));
    if (active) return { error: 'This GitHub workflow is already queued or running. Refresh the page after it finishes.' };
    if (!(await reserveRequest(actor.id, value))) {
      return { error: 'This operation was requested in the last two minutes. Refresh the page before trying again.' };
    }

    const promotionUrl = await dispatchManualGithubOperation(value);
    revalidatePath('/admin/operations/production-promotion');
    revalidatePath('/admin/operations/live-auth-tests');
    return {
      success: value === 'production-promotion'
        ? (promotionUrl === MANUAL_GITHUB_WORKFLOWS['production-recovery'].url
          ? 'Production recovery requested. Staging is already included in main; the protected workflow requires approval, takes an offsite backup, applies pending production migrations, and then rebuilds production. Follow its status below.'
          : 'Promotion monitoring requested. The GitHub workflow will verify CI/reviews, merge and check Vercel deployment and production health. Follow its status below.')
        : 'The operation was dispatched to the staging branch.',
      workflowUrl: promotionUrl ?? MANUAL_GITHUB_WORKFLOWS[value].url,
    };
  } catch (error) {
    if (error instanceof ManualGithubOperationsError || error instanceof AuthorizationError ||
      (error instanceof Error && error.name === 'CsrfError')) return { error: error.message };
    return { error: 'The GitHub operation could not be started safely.' };
  }
}
