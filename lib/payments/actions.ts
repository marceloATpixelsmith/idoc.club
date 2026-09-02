'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getUser } from '@/lib/db/queries';
import { validatedAction } from '@/lib/auth/middleware';
import { getSession } from '@/lib/auth/session';
import { requireCsrfToken } from '@/lib/security/csrf';
import { createMembershipPortalSession } from './stripe';
import { createMembershipCheckoutSession } from './checkout';

const checkoutSchema = z.object({ mode: z.enum(['payment', 'subscription']) });

export const checkoutAction = validatedAction(checkoutSchema, async ({ mode }) => {
  const user = await getUser();
  if (!user) redirect('/sign-in?redirect=pricing');
  const url = await createMembershipCheckoutSession(mode);
  redirect(url);
});

export async function manageBillingAction(formData: FormData): Promise<void> {
  await requireCsrfToken(formData, (await getSession())?.sessionId ?? null);
  const url = await createMembershipPortalSession();
  redirect(url);
}
