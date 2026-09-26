import { isOffline } from "./rpc-registry.js";
/**
 * The page's diagnostic channel to the run: one call, one behaviour. A diagnostic is reported to the run through the
 * monitor's client-log step; a page with no server (a report) reports nothing; a server that cannot be reached has
 * nowhere to take it, so that is noted for the reader of the browser console and nothing else happens; any other
 * failure is RPC plumbing, which would otherwise hide every diagnostic that follows it, so it fails fast.
 *
 * Occurrences a view records at the rate they happen go to the blip channel (client-blips.ts) instead: this is for the
 * few diagnostics a reader of the run should see beside the run's own events.
 */
import { failFastOrLog } from "@haibun/core/lib/dev-mode.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { requiredAction } from "@haibun/core/lib/actions.js";
import { stepMethodName } from "@haibun/core/lib/step-registry.js";
import { acts, conduit, isServerUnreachable } from "./hypermedia.js";

/** The monitor's step a page reports a diagnostic through. */
const CLIENT_LOG = { stepper: "MonitorStepper", step: "logClient" } as const;
const CLIENT_LOG_METHOD = stepMethodName(CLIENT_LOG.stepper, CLIENT_LOG.step);
/** What reporting a diagnostic to the run requires, which a page is delegated with what else it does. */
export const CLIENT_LOG_ACTION = requiredAction(CLIENT_LOG.stepper, CLIENT_LOG.step, {});
export type TClientLogLevel = "debug" | "info" | "warn" | "error";

export function reportToRun(level: TClientLogLevel, source: string, message: string, attributes?: Record<string, unknown>): void {
	if (isOffline()) return;
	void conduit()
		.follow(acts(CLIENT_LOG_METHOD, { event: { level, source, message, attributes } }), `${source}: ${level}`)
		.catch((err: unknown) => {
			if (isServerUnreachable(err)) return console.warn(`[${source}] not reported to the run: ${errorDetail(err)}`, { level, message });
			failFastOrLog(`[${source}] reporting to the run failed: ${errorDetail(err)}`, err);
		});
}
