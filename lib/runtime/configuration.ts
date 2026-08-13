import 'server-only';

type Environment = Partial<Record<string, string | undefined>>;
const MIN_SECRET_LENGTH = 32;

function required(environment: Environment, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Invalid production configuration: ${name}.`);
  return value;
}

function secret(environment: Environment, name: string) {
  const value = required(environment, name);
  if (value.length < MIN_SECRET_LENGTH) throw new Error(`Invalid production configuration: ${name}.`);
  return value;
}

function url(environment: Environment, name: string, protocols: string[]) {
  const value = required(environment, name);
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error(`Invalid production configuration: ${name}.`); }
  if (!protocols.includes(parsed.protocol) || !parsed.hostname) throw new Error(`Invalid production configuration: ${name}.`);
  return value;
}

export function databaseUrlForServer(environment: Environment = process.env) {
  return url(environment, 'POSTGRES_URL', ['postgres:', 'postgresql:']);
}

export function stripeKeyForServer(environment: Environment = process.env) {
  const value = required(environment, 'STRIPE_SECRET_KEY');
  if (!/^sk_(?:test|live)_[A-Za-z0-9]{16,}$/.test(value)) throw new Error('Invalid production configuration: STRIPE_SECRET_KEY.');
  return value;
}

export function authSecretForServer(environment: Environment = process.env) { return secret(environment, 'AUTH_SECRET'); }
export function baseUrlForServer(environment: Environment = process.env) {
  const value = url(environment, 'BASE_URL', environment.NODE_ENV === 'production' ? ['https:'] : ['http:', 'https:']);
  const parsed = new URL(value);
  if (parsed.protocol === 'http:' && !['127.0.0.1', '[::1]', 'localhost'].includes(parsed.hostname)) {
    throw new Error('Invalid production configuration: BASE_URL.');
  }
  return value;
}
export function cronSecretForServer(environment: Environment = process.env) { return secret(environment, 'CRON_SECRET'); }
export function mailchimpApiKeyForServer(environment: Environment = process.env) { return secret(environment, 'MAILCHIMP_TRANSACTIONAL_API_KEY'); }
export function rateLimitHashKeyForServer(environment: Environment = process.env) { return secret(environment, 'RATE_LIMIT_HASH_KEY'); }

export function accountDeliveryConfiguration(environment: Environment = process.env) {
  const activeVersion = required(environment, 'ACCOUNT_DELIVERY_KEY_VERSION');
  if (!/^[A-Za-z0-9_-]{1,30}$/.test(activeVersion)) throw new Error('Invalid production configuration: ACCOUNT_DELIVERY_KEY_VERSION.');
  const serialized = required(environment, 'ACCOUNT_DELIVERY_ENCRYPTION_KEYS');
  let value: unknown;
  try { value = JSON.parse(serialized); } catch { throw new Error('Invalid production configuration: ACCOUNT_DELIVERY_ENCRYPTION_KEYS.'); }
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Invalid production configuration: ACCOUNT_DELIVERY_ENCRYPTION_KEYS.');
  const keys = Object.fromEntries(Object.entries(value).map(([version, material]) => {
    if (!/^[A-Za-z0-9_-]{1,30}$/.test(version) || typeof material !== 'string' || material.length < MIN_SECRET_LENGTH) throw new Error('Invalid production configuration: ACCOUNT_DELIVERY_ENCRYPTION_KEYS.');
    return [version, material];
  }));
  if (!keys[activeVersion]) throw new Error('Invalid production configuration: ACCOUNT_DELIVERY_KEY_VERSION.');
  return { activeVersion, keys };
}

export function privilegedProductionConfiguration(environment: Environment = process.env) {
  const adminEmail = required(environment, 'IDOC_ADMIN_NOTIFICATION_EMAIL');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) throw new Error('Invalid production configuration: IDOC_ADMIN_NOTIFICATION_EMAIL.');
  return {
    accountDelivery: accountDeliveryConfiguration(environment), adminEmail,
    authSecret: authSecretForServer(environment), baseUrl: baseUrlForServer(environment),
    cronSecret: secret(environment, 'CRON_SECRET'), databaseUrl: databaseUrlForServer(environment),
    mailchimpApiKey: secret(environment, 'MAILCHIMP_TRANSACTIONAL_API_KEY'),
    rateLimitHashKey: secret(environment, 'RATE_LIMIT_HASH_KEY'), stripeKey: stripeKeyForServer(environment),
    stripeWebhookSecret: secret(environment, 'STRIPE_WEBHOOK_SECRET'),
  };
}
