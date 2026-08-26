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
import { conduit, isOffline, isServerUnreachable } from "./hypermedia.js";

export const CLIENT_LOG_METHOD = "MonitorStepper-logClient";
export type TClientLogLevel = "debug" | "info" | "warn" | "error";

export function reportToRun(level: TClientLogLevel, source: string, message: string, attributes?: Record<string, unknown>): void {
	if (isOffline()) return;
	void conduit()
		.follow({ method: CLIENT_LOG_METHOD, params: { event: { level, source, message, attributes } } }, `${source}: ${level}`)
		.catch((err: unknown) => {
			if (isServerUnreachable(err)) return console.warn(`[${source}] not reported to the run: ${errorDetail(err)}`, { level, message });
			failFastOrLog(`[${source}] reporting to the run failed: ${errorDetail(err)}`, err);
		});
}
