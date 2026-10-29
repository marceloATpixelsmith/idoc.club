'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { db } from '@/lib/db/drizzle';
import { auditLog, membershipHealthCases } from '@/lib/db/schema';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';
import { requireCsrfToken } from '@/lib/security/csrf';

const updateSchema = z.object({
  id: z.coerce.number().int().positive(),
  status: z.enum(['new', 'investigating', 'resolved', 'dismissed']),
  assignment: z.enum(['keep', 'me', 'unassigned']),
  resolutionNote: z.string().trim().max(2000),
}).superRefine((value, ctx) => {
  if (['resolved', 'dismissed'].includes(value.status) && value.resolutionNote.length < 10) {
    ctx.addIssue({ code: 'custom', path: ['resolutionNote'], message: 'A resolution explanation of at least 10 characters is required.' });
  }
});

// ONLY THE STATUS, OWNER AND RESOLUTION NOTE ARE EDITABLE. THE DETECTION
// EVIDENCE IS SERVER-OWNED AND ALL HUMAN DECISIONS ARE WRITTEN TO AUDIT LOG.
export async function updateMembershipHealthCase(formData: FormData): Promise<void> {
  await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const values = updateSchema.parse({
    id: formData.get('id'),
    status: formData.get('status'),
    assignment: formData.get('assignment'),
    resolutionNote: formData.get('resolutionNote'),
  });
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(membershipHealthCases)
      .where(eq(membershipHealthCases.id, values.id)).for('update').limit(1);
    if (!before) throw new Error('The investigation case no longer exists.');
    const [after] = await tx.update(membershipHealthCases).set({
      status: values.status,
      assignedToUserId: values.assignment === 'me' ? actor.id
        : values.assignment === 'unassigned' ? null : before.assignedToUserId,
      resolutionNote: values.resolutionNote || null,
      resolvedAt: values.status === 'resolved' || values.status === 'dismissed' ? new Date() : null,
      updatedAt: new Date(),
    }).where(eq(membershipHealthCases.id, values.id)).returning();
    await tx.insert(auditLog).values({
      actorId: actor.id,
      action: 'admin.membership_health.case_updated',
      entityType: 'membership_health_case',
      entityId: String(values.id),
      beforeJson: { status: before.status, assignedToUserId: before.assignedToUserId, resolutionNote: before.resolutionNote },
      afterJson: { status: after.status, assignedToUserId: after.assignedToUserId, resolutionNote: after.resolutionNote },
      reason: values.resolutionNote || 'Investigation status or assignment updated',
    });
  });
  revalidatePath('/admin/membership-health');
  redirect('/admin/membership-health?tab=issues');
}
