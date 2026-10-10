// New Relic Browser (real-user monitoring) configuration. The browser licence key, account and
// application IDs are public identifiers shipped to every visitor, not secrets. Everything here is
// inert unless ALL identifiers are present AND the deployment is the staging branch, so production
// cannot start sending browser telemetry through a stray environment variable; enabling production
// is a deliberate code change.
export const NEW_RELIC_BEACON_HOST = 'bam.nr-data.net';

export type BrowserAgentEnvironment = Partial<{
  NEXT_PUBLIC_NEW_RELIC_BROWSER_ACCOUNT_ID: string;
  NEXT_PUBLIC_NEW_RELIC_BROWSER_AGENT_ID: string;
  NEXT_PUBLIC_NEW_RELIC_BROWSER_APPLICATION_ID: string;
  NEXT_PUBLIC_NEW_RELIC_BROWSER_LICENSE_KEY: string;
  NEXT_PUBLIC_NEW_RELIC_BROWSER_TRUST_KEY: string;
  NEXT_PUBLIC_VERCEL_ENV: string;
  NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF: string;
  VERCEL_ENV: string;
  VERCEL_GIT_COMMIT_REF: string;
}>;

const NUMERIC_ID = /^[0-9]{1,20}$/;
const LICENSE_KEY = /^[A-Za-z0-9-]{8,64}$/;

// Literal property reads so Next inlines the NEXT_PUBLIC_* values into client and edge bundles.
export function browserAgentEnvironmentFromProcess(): BrowserAgentEnvironment {
  return {
    NEXT_PUBLIC_NEW_RELIC_BROWSER_ACCOUNT_ID: process.env.NEXT_PUBLIC_NEW_RELIC_BROWSER_ACCOUNT_ID,
    NEXT_PUBLIC_NEW_RELIC_BROWSER_AGENT_ID: process.env.NEXT_PUBLIC_NEW_RELIC_BROWSER_AGENT_ID,
    NEXT_PUBLIC_NEW_RELIC_BROWSER_APPLICATION_ID:
      process.env.NEXT_PUBLIC_NEW_RELIC_BROWSER_APPLICATION_ID,
    NEXT_PUBLIC_NEW_RELIC_BROWSER_LICENSE_KEY: process.env.NEXT_PUBLIC_NEW_RELIC_BROWSER_LICENSE_KEY,
    NEXT_PUBLIC_NEW_RELIC_BROWSER_TRUST_KEY: process.env.NEXT_PUBLIC_NEW_RELIC_BROWSER_TRUST_KEY,
    NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF,
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF,
  };
}

export type BrowserAgentConfig = {
  info: {
    beacon: string;
    errorBeacon: string;
    licenseKey: string;
    applicationID: string;
    sa: 1;
  };
  loader_config: {
    accountID: string;
    trustKey: string;
    agentID: string;
    licenseKey: string;
    applicationID: string;
  };
  init: {
    privacy: { cookies_enabled: false };
    distributed_tracing: { enabled: false };
    ajax: { enabled: false };
    session_replay: { enabled: false };
    session_trace: { enabled: false };
    generic_events: { enabled: false };
    page_action: { enabled: false };
    soft_navigations: { enabled: false };
    obfuscate: { regex: RegExp; replacement: string }[];
  };
};

// Staging means the dedicated always-on Preview deployment of the `staging` branch. This looks only
// at Vercel's own environment and branch, deliberately not at any manually set environment label.
function isStagingDeployment(environment: BrowserAgentEnvironment): boolean {
  const vercelEnvironment = environment.VERCEL_ENV ?? environment.NEXT_PUBLIC_VERCEL_ENV;
  const gitRef = environment.VERCEL_GIT_COMMIT_REF ?? environment.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF;
  return vercelEnvironment === 'preview' && gitRef === 'staging';
}

// Returns null (agent disabled) unless every identifier is well formed and this is staging.
export function browserAgentConfig(
  environment: BrowserAgentEnvironment = browserAgentEnvironmentFromProcess(),
): BrowserAgentConfig | null {
  if (!isStagingDeployment(environment)) return null;
  const accountID = environment.NEXT_PUBLIC_NEW_RELIC_BROWSER_ACCOUNT_ID?.trim() ?? '';
  const agentID = environment.NEXT_PUBLIC_NEW_RELIC_BROWSER_AGENT_ID?.trim() ?? '';
  const applicationID = environment.NEXT_PUBLIC_NEW_RELIC_BROWSER_APPLICATION_ID?.trim() ?? '';
  const licenseKey = environment.NEXT_PUBLIC_NEW_RELIC_BROWSER_LICENSE_KEY?.trim() ?? '';
  const trustKey = environment.NEXT_PUBLIC_NEW_RELIC_BROWSER_TRUST_KEY?.trim() || accountID;
  if (![accountID, agentID, applicationID, trustKey].every((value) => NUMERIC_ID.test(value))) {
    return null;
  }
  if (!LICENSE_KEY.test(licenseKey)) return null;
  return {
    info: {
      beacon: NEW_RELIC_BEACON_HOST,
      errorBeacon: NEW_RELIC_BEACON_HOST,
      licenseKey,
      applicationID,
      sa: 1,
    },
    loader_config: { accountID, trustKey, agentID, licenseKey, applicationID },
    init: {
      // Page views, Core Web Vitals and JavaScript errors only. Everything that could capture page
      // content, form input, request URLs or a user session is off, and its feature module is not
      // bundled (see components/observability/new-relic-browser.tsx).
      privacy: { cookies_enabled: false },
      distributed_tracing: { enabled: false },
      ajax: { enabled: false },
      session_replay: { enabled: false },
      session_trace: { enabled: false },
      generic_events: { enabled: false },
      page_action: { enabled: false },
      soft_navigations: { enabled: false },
      // JavaScript error messages can echo user-entered values; redact anything shaped like an email.
      obfuscate: [{ regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, replacement: '[redacted-email]' }],
    },
  };
}

// CSP connect-src origin for the browser agent; empty when the agent is disabled.
export function browserAgentConnectOrigin(
  environment: BrowserAgentEnvironment = browserAgentEnvironmentFromProcess(),
): string {
  return browserAgentConfig(environment) ? `https://${NEW_RELIC_BEACON_HOST}` : '';
}
