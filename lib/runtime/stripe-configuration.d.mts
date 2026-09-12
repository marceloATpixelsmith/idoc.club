export type StripeEnvironment = Partial<Record<string, string | undefined>>;

export function stripeDeploymentMode(environment?: StripeEnvironment): 'live' | 'test';
export function validateStripeKey(
  environment?: StripeEnvironment,
  options?: { browserVerification?: boolean },
): { mode: 'live' | 'test'; value: string };
export function validateStripeWebhookSecret(environment?: StripeEnvironment): string;
export function validateStripeMembershipProductId(environment?: StripeEnvironment): string;
export function validateStripeBaseUrl(environment?: StripeEnvironment): string;
export function validateStripeReadiness(
  environment?: StripeEnvironment,
  options?: { browserVerification?: boolean },
): { baseUrl: string; keyMode: 'live' | 'test'; membershipProductId: string; webhookSecret: string };
