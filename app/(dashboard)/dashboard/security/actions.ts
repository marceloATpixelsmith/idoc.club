'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { validatedActionWithUser } from '@/lib/auth/middleware';
import { comparePasswords } from '@/lib/auth/session';
import {
  createImmediateGoogleUnlinkFreshEvidence,
  issueGoogleLinkFreshEvidence,
} from '@/lib/auth/google-identity-link-evidence';
import { unlinkGoogleIdentity } from '@/lib/auth/google-identity-linking';
import { consumeFreshStepUp, requireFreshStepUp } from '@/lib/auth/mfa/step-up';

const currentPasswordSchema = z.object({ currentPassword: z.string().min(1).max(128) });

export const beginGoogleIdentityLink = validatedActionWithUser(
  currentPasswordSchema,
  async ({ currentPassword }, _, user) => {
    if ((await requireFreshStepUp(user, 'change-security-settings', '/dashboard/security')).required) redirect('/mfa');
    if (!(await comparePasswords(currentPassword, user.passwordHash))) {
      return { error: 'Current password is incorrect.' };
    }
    await issueGoogleLinkFreshEvidence(user.id);
    await consumeFreshStepUp();
    redirect('/api/auth/google/link/start');
  },
);

export const disconnectGoogleIdentity = validatedActionWithUser(
  currentPasswordSchema,
  async ({ currentPassword }, _, user) => {
    if ((await requireFreshStepUp(user, 'change-security-settings', '/dashboard/security')).required) redirect('/mfa');
    if (!(await comparePasswords(currentPassword, user.passwordHash))) {
      return { error: 'Current password is incorrect.' };
    }
    const result = await unlinkGoogleIdentity({
      userId: String(user.id),
      freshEvidence: createImmediateGoogleUnlinkFreshEvidence(user.id),
    });
    if (result.status === 'unlinked') await consumeFreshStepUp();
    if (result.status === 'unlinked') return { success: 'Google account disconnected.' };
    if (result.status === 'not-linked') return { success: 'No Google account is connected.' };
    return { error: 'Add another sign-in method before disconnecting Google.' };
  },
);
