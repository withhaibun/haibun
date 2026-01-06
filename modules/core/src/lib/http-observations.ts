/**
 * Shared HTTP observation types and helpers.
 * 
 * Used by any stepper that tracks HTTP activity, including:
 * - NodeHttpEvents (Node.js fetch/undici requests)
 * - PlaywrightEvents (browser requests via Playwright)
 */

import type { TWorld } from './defs.js';
import type { TAnyFixme } from './fixme.js';

/** Observation data for a single HTTP request */
export type THttpRequestObservation = {
  url: string;
  status: number;
  time: number;
  method: string;
};

/**
 * Track an HTTP host in observations for the 'http-trace hosts' observation source.
 * Both NodeHttpEvents and PlaywrightEvents use this.
 */
export function trackHttpHost(world: TWorld, url: string): void {
  try {
    const parsedUrl = new URL(url);
    const host = parsedUrl.hostname;
    if (!world.runtime.observations) {
      world.runtime.observations = new Map();
    }
    const httpHosts = (world.runtime.observations.get('httpHosts') as Map<string, number>) || new Map<string, number>();
    httpHosts.set(host, (httpHosts.get(host) || 0) + 1);
    world.runtime.observations.set('httpHosts', httpHosts);
  } catch {
    // Invalid URL, skip tracking
  }
}

/**
 * Track an HTTP request in observations for the 'http-trace' observation source.
 */
export function trackHttpRequest(world: TWorld, observation: THttpRequestObservation): void {
  if (!world.runtime.observations) {
    world.runtime.observations = new Map();
  }
  const requests = (world.runtime.observations.get('httpRequests') as Map<string, THttpRequestObservation>) || new Map<string, THttpRequestObservation>();
  const count = requests.size;
  const id = `req-${count + 1}`;
  requests.set(id, observation);
  world.runtime.observations.set('httpRequests', requests);

  // Emit quadObservation with hierarchical context for graph visualization
  const timestamp = Date.now();
  world.eventLogger?.emit({
    id: `quad-http-${timestamp}-${id}`,
    timestamp,
    source: 'haibun',
    level: 'debug' as const,
    kind: 'artifact' as const,
    artifactType: 'json' as const,
    mimetype: 'application/json',
    json: {
      quadObservation: {
        subject: id,
        predicate: 'time',
        object: observation.time,
        context: 'observation/http',
      }
    },
  });
}
