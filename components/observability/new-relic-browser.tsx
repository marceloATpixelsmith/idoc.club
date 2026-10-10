'use client';

import { useEffect } from 'react';
import { browserAgentConfig, browserAgentEnvironmentFromProcess } from '@/lib/observability/browser-agent-config';

let started = false;

// New Relic Browser (real-user monitoring), staging only and inert unless configured; see
// lib/observability/browser-agent-config.ts. Only the page-view, page-view-timing (Core Web Vitals)
// and JavaScript-error feature modules are imported: session replay, session trace, AJAX capture
// and generic/user-action events are not bundled at all. The agent is bundled with the app, so no
// third-party script origin is added to script-src; it only reports to the New Relic beacon host
// allowed in connect-src.
export function NewRelicBrowser() {
  useEffect(() => {
    if (started) return;
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
  }, []);
  return null;
}
