import 'server-only';

import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { renewalPreferences, subscriptions } from '@/lib/db/schema';
import { assertLiveBillingAllowed } from '@/lib/runtime/member-launch-hold';
import { OPEN_SUBSCRIPTION_STATUSES } from './pricing';
import { getStripeServerClient } from './stripe-client';
import { cancelMemberSubscriptionAtPeriodEnd, type CancellationStripeClient } from './stripe';

//CANCELLATION IS SHARED BY MEMBER AND ADMINISTRATOR ACTIONS AFTER THEIR MEMBERSHIP CHANGE COMMITS.
//PROVIDER FAILURES LEAVE THE SCHEDULE REFERENCE IN PLACE SO THE SAME ACTION CAN RETRY.
export async function cancelOpenSubscriptionIfAny(profileId: number, testStripeClient?: CancellationStripeClient): Promise<{ stripeCancelError?: string; stripeCancelled: boolean }>
    {
    const errors: string[] = [];
    let stripeCancelled = false;
    const subscriptionIds = new Set<string>();
    const openSubscriptions = await db.select({ externalSubscriptionId: subscriptions.externalSubscriptionId })
        .from(subscriptions)
        .where(and(eq(subscriptions.profileId, profileId), inArray(subscriptions.status, OPEN_SUBSCRIPTION_STATUSES)))
        .orderBy(desc(subscriptions.createdAt));
    for (const subscription of openSubscriptions) subscriptionIds.add(subscription.externalSubscriptionId);
    const [preference] = await db.select().from(renewalPreferences)
        .where(eq(renewalPreferences.profileId, profileId)).limit(1);
    const scheduleId = preference?.externalSubscriptionScheduleId;
    let scheduleStopped = false;
    if (scheduleId)
        {
        try
            {
            assertLiveBillingAllowed('billing.cancelMemberSubscriptionAtPeriodEnd');
            if (testStripeClient && process.env.NODE_ENV !== 'test') throw new Error('Stripe client overrides are test-only.');
            const stripe = testStripeClient ?? getStripeServerClient();
            if (!stripe.subscriptionSchedules) throw new Error('Stripe schedule cancellation is unavailable.');
            const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
            const subscriptionId = typeof schedule.subscription === 'string' ? schedule.subscription : schedule.subscription?.id;
            if (schedule.status === 'not_started' || schedule.status === 'active')
                {
                //RELEASE IS SAFE IF A FUTURE SCHEDULE ACTIVATES DURING THE REQUEST; IT NEVER CANCELS THE PAID SUBSCRIPTION.
                const released = await stripe.subscriptionSchedules.release(scheduleId);
                const releasedId = released.released_subscription ?? subscriptionId;
                if (releasedId) subscriptionIds.add(releasedId);
                else if (schedule.status === 'active') throw new Error('The released renewal schedule has no subscription.');
                }
            else if (schedule.status === 'released' || schedule.status === 'completed')
                {
                const releasedId = schedule.released_subscription ?? subscriptionId;
                if (releasedId) subscriptionIds.add(releasedId);
                }
            else if (schedule.status !== 'canceled')
                {
                throw new Error('The renewal schedule has an unknown status.');
                }
            scheduleStopped = true;
            stripeCancelled = true;
            }
        catch (error)
            {
            errors.push(error instanceof Error ? error.message : 'Unknown Stripe schedule error.');
            }
        }
    //ATTEMPT EVERY OPEN SUBSCRIPTION EVEN WHEN SCHEDULE CANCELLATION FAILED.
    for (const subscriptionId of subscriptionIds)
        {
        try
            {
            await cancelMemberSubscriptionAtPeriodEnd(subscriptionId, testStripeClient);
            stripeCancelled = true;
            }
        catch (error)
            {
            errors.push(error instanceof Error ? error.message : 'Unknown Stripe error.');
            }
        }
    if (scheduleStopped && errors.length === 0)
        {
        await db.update(renewalPreferences).set({
            currentMode: 'non_recurring', effectiveOn: null, expectedChargeCents: null,
            externalCheckoutSessionId: null, externalPaymentMethodId: null, externalSetupIntentId: null,
            externalRecurringPriceId: null, externalSubscriptionScheduleId: null,
            pendingMode: null, transitionState: 'current', updatedAt: new Date(),
        }).where(and(eq(renewalPreferences.profileId, profileId), eq(renewalPreferences.externalSubscriptionScheduleId, scheduleId!)));
        }
    return errors.length > 0 ? { stripeCancelError: errors.join(' '), stripeCancelled: false } : { stripeCancelled };
    }
