'use server';

import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import {
  users,
  teams,
  teamMembers,
  activityLogs,
  type NewActivityLog,
  ActivityType,
  invitations
} from '@/lib/db/schema';
import { comparePasswords, hashPassword, passwordHashNeedsUpgrade, setSession } from '@/lib/auth/session';
import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { getUserWithTeam } from '@/lib/db/queries';
import {
  validatedAction,
  validatedActionWithUser
} from '@/lib/auth/middleware';
import { normalizeEmail } from '@/lib/membership/validation';
import { deleteOwnAccount } from '@/lib/membership/data-access';
import { issueEmailVerification } from '@/lib/membership/email-verification';
import { passwordSchema } from '@/lib/auth/password-policy';
import { consumeAccountToken, requestAccountLink } from '@/lib/membership/account-recovery';

async function logActivity(
  teamId: number | null | undefined,
  userId: number,
  type: ActivityType,
  ipAddress?: string
) {
  if (teamId === null || teamId === undefined) return;
  const newActivity: NewActivityLog = {
    teamId,
    userId,
    action: type,
    ipAddress: ipAddress || ''
  };
  await db.insert(activityLogs).values(newActivity);
}

const signInSchema = z.object({
  email: z.string().email().min(3).max(255),
  // Login verifies the existing credential exactly as supplied. Creation policy belongs only on
  // password creation/change boundaries and must not strand a valid legacy credential.
  password: z.string().min(1).max(128)
});

export const signIn = validatedAction(signInSchema, async (data) => {
  const { password } = data;
  const email = normalizeEmail(data.email);

  const matchingUsers = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (matchingUsers.length === 0) return { error: 'Invalid email or password. Please try again.', email };

  const foundUser = matchingUsers[0];
  const isPasswordValid = await comparePasswords(password, foundUser.passwordHash);

  if (!isPasswordValid || !foundUser.emailVerifiedAt ||
      !['active', 'onboarding'].includes(foundUser.accountState)) {
    return { error: 'Invalid email or password. Please try again.', email };
  }

  if (passwordHashNeedsUpgrade(foundUser.passwordHash)) {
    const upgradedHash = await hashPassword(password);
    await db.update(users)
      .set({ passwordHash: upgradedHash, updatedAt: new Date() })
      .where(and(eq(users.id, foundUser.id), eq(users.passwordHash, foundUser.passwordHash)));
  }

  await setSession(foundUser);
  redirect('/dashboard');
});

const accountLinkSchema = z.object({ email: z.string().email().max(255) });
const NEUTRAL_RECOVERY = 'If an eligible account uses this address, an email will be sent.';

export const requestPasswordRecovery = validatedAction(accountLinkSchema, async ({ email }) => {
  const requestHeaders = await headers();
  const origin = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? requestHeaders.get('x-real-ip') ?? 'unknown';
  await requestAccountLink(email, 'password_reset', origin);
  return { success: NEUTRAL_RECOVERY };
});

export const requestMigrationActivation = validatedAction(accountLinkSchema, async ({ email }) => {
  const requestHeaders = await headers();
  const origin = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? requestHeaders.get('x-real-ip') ?? 'unknown';
  await requestAccountLink(email, 'migration_activation', origin);
  return { success: NEUTRAL_RECOVERY };
});

const consumeTokenSchema = z.object({ confirmPassword: passwordSchema, password: passwordSchema, token: z.string().max(100) })
  .refine(({ confirmPassword, password }) => confirmPassword === password, { message: 'Passwords do not match.' });

export const resetPassword = validatedAction(consumeTokenSchema, async ({ password, token }) => {
  const result = await consumeAccountToken(token, 'password_reset', password);
  return result.status === 'success' ? { success: 'Your password was reset. Sign in again on every device.' } : { error: 'This reset link is invalid or expired.' };
});

export const activateMigratedAccount = validatedAction(consumeTokenSchema, async ({ password, token }) => {
  const result = await consumeAccountToken(token, 'migration_activation', password);
  return result.status === 'success' ? { success: 'Your account is active. Sign in to review your imported profile.' } : { error: 'This activation link is invalid or expired.' };
});

const resendVerificationSchema = z.object({ email: z.string().email().max(255) });

export const resendVerification = validatedAction(resendVerificationSchema, async (data) => {
  const email = normalizeEmail(data.email);
  const [user] = await db.select({ emailVerifiedAt: users.emailVerifiedAt, id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (user && !user.emailVerifiedAt) await issueEmailVerification(user.id, email);
  return { success: 'If an unverified account uses this address, a verification email will be sent.' };
});

export async function signOut() {
  (await cookies()).delete('session');
}

const updatePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
  confirmPassword: passwordSchema
});

export const updatePassword = validatedActionWithUser(
  updatePasswordSchema,
  async (data, _, user) => {
    const { currentPassword, newPassword, confirmPassword } = data;

    const isPasswordValid = await comparePasswords(currentPassword, user.passwordHash);
    if (!isPasswordValid) return { error: 'Current password is incorrect.' };
    if (currentPassword === newPassword) return { error: 'New password must be different from the current password.' };
    if (confirmPassword !== newPassword) return { error: 'New password and confirmation password do not match.' };

    const newPasswordHash = await hashPassword(newPassword);
    await db.update(users).set({ passwordHash: newPasswordHash }).where(eq(users.id, user.id));
    return { success: 'Password updated successfully.' };
  }
);

const deleteAccountSchema = z.object({ password: z.string().min(1).max(128) });

export const deleteAccount = validatedActionWithUser(
  deleteAccountSchema,
  async (data, _, user) => {
    const isPasswordValid = await comparePasswords(data.password, user.passwordHash);
    if (!isPasswordValid) return { error: 'Incorrect password. Account deletion failed.' };
    await deleteOwnAccount();
    (await cookies()).delete('session');
    redirect('/sign-in');
  }
);

const updateAccountSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  email: z.string().email('Invalid email address')
});

export const updateAccount = validatedActionWithUser(
  updateAccountSchema,
  async (data, _, user) => {
    const name = data.name;
    const email = normalizeEmail(data.email);
    await db.update(users).set({ name }).where(eq(users.id, user.id));
    if (email !== user.email) {
      const [duplicate] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (duplicate) return { error: 'That email address is unavailable.', name };
      await issueEmailVerification(user.id, email);
      return { name, success: 'Check the new address to verify your email change.' };
    }
    return { name, success: 'Account updated successfully.' };
  }
);

const removeTeamMemberSchema = z.object({ memberId: z.number() });

export const removeTeamMember = validatedActionWithUser(
  removeTeamMemberSchema,
  async (data, _, user) => {
    const userWithTeam = await getUserWithTeam(user.id);
    if (!userWithTeam?.teamId) return { error: 'User is not part of a team' };

    await db.delete(teamMembers).where(and(eq(teamMembers.id, data.memberId), eq(teamMembers.teamId, userWithTeam.teamId)));
    await logActivity(userWithTeam.teamId, user.id, ActivityType.REMOVE_TEAM_MEMBER);
    return { success: 'Team member removed successfully' };
  }
);

const inviteTeamMemberSchema = z.object({ email: z.string().email('Invalid email address'), role: z.enum(['member', 'owner']) });

export const inviteTeamMember = validatedActionWithUser(
  inviteTeamMemberSchema,
  async (data, _, user) => {
    const { email, role } = data;
    const userWithTeam = await getUserWithTeam(user.id);
    if (!userWithTeam?.teamId) return { error: 'User is not part of a team' };

    const existingMember = await db.select().from(users).leftJoin(teamMembers, eq(users.id, teamMembers.userId))
      .where(and(eq(users.email, email), eq(teamMembers.teamId, userWithTeam.teamId))).limit(1);
    if (existingMember.length > 0) return { error: 'User is already a member of this team' };

    const existingInvitation = await db.select().from(invitations)
      .where(and(eq(invitations.email, email), eq(invitations.teamId, userWithTeam.teamId), eq(invitations.status, 'pending'))).limit(1);
    if (existingInvitation.length > 0) return { error: 'An invitation has already been sent to this email' };

    await db.insert(invitations).values({
      teamId: userWithTeam.teamId,
      email,
      role,
      invitedBy: user.id,
      status: 'pending'
    });
    await logActivity(userWithTeam.teamId, user.id, ActivityType.INVITE_TEAM_MEMBER);
    return { success: 'Invitation sent successfully' };
  }
);
