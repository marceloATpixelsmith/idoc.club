'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getUser } from '@/lib/db/queries';
import { validatedAction } from '@/lib/auth/middleware';
import { createCustomerPortalSession } from './stripe';
import { createMembershipCheckoutSession } from './checkout';
import { withTeam } from '@/lib/auth/middleware';

const checkoutSchema = z.object({ mode: z.enum(['payment', 'subscription']) });

export const checkoutAction = validatedAction(checkoutSchema, async ({ mode }) => {
  const user = await getUser();
  if (!user) redirect('/sign-in?redirect=pricing');
  const url = await createMembershipCheckoutSession(mode);
  redirect(url);
});

export const customerPortalAction = withTeam(async (_, team) => {
  const portalSession = await createCustomerPortalSession(team);
  redirect(portalSession.url);
});
