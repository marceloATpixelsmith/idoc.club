import { z } from 'zod';

/** Sensitive migration input is supplied at run time and never committed. Missing WordPress-row
 * exceptions are accepted only with an exact Stripe subscription mapping whose identity and
 * paid-through evidence were independently verified by an operator. */
export const missingWordPressUserMappingSchema = z.object({
  email: z.string().email().max(255),
  identitySource: z.literal('stripe_live_verified'),
  memberpressUserId: z.string().regex(/^\d+$/),
  paidThrough: z.string().date(),
  profile: z.object({
    address1: z.string().max(200).nullable(),
    address2: z.string().max(200).nullable(),
    city: z.string().max(100).nullable(),
    countryCode: z.string().length(2).nullable(),
    firstName: z.string().max(100).nullable(),
    lastName: z.string().max(100).nullable(),
    postalCode: z.string().max(30).nullable(),
    stateProvince: z.string().max(100).nullable(),
  }).strict(),
  stripeSubscriptionId: z.string().regex(/^sub_[A-Za-z0-9]+$/),
}).strict();

export type MissingWordPressUserMapping = z.infer<typeof missingWordPressUserMappingSchema>;

export function validateMissingWordPressUserMapping(input: unknown): MissingWordPressUserMapping {
  return missingWordPressUserMappingSchema.parse(input);
}
