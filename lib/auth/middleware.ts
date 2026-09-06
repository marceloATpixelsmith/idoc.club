import { z } from 'zod';
import { User } from '@/lib/db/schema';
import { getUser } from '@/lib/db/queries';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { requireCsrfToken } from '@/lib/security/csrf';

export type ActionState = {
  error?: string;
  success?: string;
  [key: string]: any; // This allows for additional properties
};

type ValidatedActionFunction<S extends z.ZodType<any, any>, T> = (
  data: z.infer<S>,
  formData: FormData
) => Promise<T>;

export function validatedAction<S extends z.ZodType<any, any>, T>(
  schema: S,
  action: ValidatedActionFunction<S, T>,
  // Set only by the small family of pending-primary-auth-driven MFA actions
  // (app/(login)/mfa/actions.ts), which perform their own CSRF check once they've resolved the
  // pending flow (accepting either the general cookie or the flow's own per-flow nonce -- see
  // lib/security/csrf.ts's requireCsrfTokenOrPendingNonce) instead of the unconditional check below.
  options?: { skipCsrf?: boolean },
) {
  return async (prevState: ActionState, formData: FormData) => {
    if (!options?.skipCsrf) {
      await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
    }

    const result = schema.safeParse(Object.fromEntries(formData));
    if (!result.success) {
      return { error: result.error.errors[0].message };
    }

    return action(result.data, formData);
  };
}

type ValidatedActionWithUserFunction<S extends z.ZodType<any, any>, T> = (
  data: z.infer<S>,
  formData: FormData,
  user: User
) => Promise<T>;

export function validatedActionWithUser<S extends z.ZodType<any, any>, T>(
  schema: S,
  action: ValidatedActionWithUserFunction<S, T>,
  // Every consumer of this wrapper is an account-mutating action (change password, delete account,
  // update name/email, link/unlink Google, forget a remembered device, replace an authenticator,
  // regenerate recovery codes) except signing a *different* session out, which docs/25 section 1
  // requires stay reachable for a never-paid or post-grace-expired account alongside the payment
  // gate ("receive only the membership-payment gate and logout") -- logOutSession/
  // logOutOtherSessions pass this to keep using the permissive, read-adjacent 'account' operation.
  options?: { allowWithoutEntitlement?: boolean },
) {
  return async (prevState: ActionState, formData: FormData) => {
    const user = await getUser();
    if (!user) {
      throw new Error('User is not authenticated');
    }
    await requireCsrfToken(formData, await rawCanonicalSessionId(), user.id);
    await requireAccountAccess(options?.allowWithoutEntitlement ? 'account' : 'account_mutation');

    const result = schema.safeParse(Object.fromEntries(formData));
    if (!result.success) {
      return { error: result.error.errors[0].message };
    }

    return action(result.data, formData, user);
  };
}
