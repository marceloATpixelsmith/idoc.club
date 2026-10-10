import { browserAgentConfig, browserAgentEnvironmentFromProcess } from './browser-agent-config.ts';

let started = false;

// Starts the New Relic Browser agent (real-user monitoring) from instrumentation-client.ts, which
// Next runs before hydration, so client startup errors are in scope. Staging only and inert unless
// configured; see browser-agent-config.ts. Only the page-view, page-view-timing (Core Web Vitals)
// and JavaScript-error feature modules are imported: session replay, session trace, AJAX capture
// and generic/user-action events are not bundled at all. The agent code is a dynamic import behind
// the configuration check, so deployments where it is disabled do not load it, and it is bundled
// with the app so no third-party script origin is added to script-src (only the beacon host in
// connect-src). Errors thrown in the first moments before the agent chunk loads are still captured
// by Sentry, which initializes synchronously in the same file.
export function startNewRelicBrowser(): void {
  if (started || typeof window === 'undefined') return;
  const config = browserAgentConfig(browserAgentEnvironmentFromProcess());
  if (!config) return;
  started = true;
  void (async () => {
    try {
      const [{ Agent }, { PageViewEvent }, { PageViewTiming }, { JSErrors }] = await Promise.all([
        import('@newrelic/browser-agent/loaders/agent'),
        import('@newrelic/browser-agent/features/page_view_event'),
        import('@newrelic/browser-agent/features/page_view_timing'),
        import('@newrelic/browser-agent/features/jserrors'),
      ]);
      new Agent({
        info: config.info,
        loader_config: config.loader_config,
        init: config.init,
        features: [PageViewEvent, PageViewTiming, JSErrors],
      });
    } catch {
      // Monitoring must never affect the page; a failed agent load is silently skipped.
      started = false;
    }
  })();
}
