import { isOffline } from "./rpc-registry.js";
import { authorityFailed, refusalCarried } from "@haibun/core/lib/rpc-wire.js";
/**
 * The page's diagnostic channel to actuality: one call, one behaviour. A diagnostic is reported to actuality through the
 * monitor's client-log step; a page without a server (a report) or without a conduit to one doesn't report it; a server that cannot be reached doesn't
 * receive it, so that is noted for the reader of the browser console and the call returns; any other
 * failure is RPC plumbing, which would otherwise hide every diagnostic that follows it, so it fails fast.
 *
 * Occurrences a view records at the rate they happen go to the blip channel (client-blips.ts) instead: this is for the
 * few diagnostics a reader of actuality should see beside actuality's own events.
 */
import { failFastOrLog, isDev } from "@haibun/core/lib/dev-mode.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { requiredAction } from "@haibun/core/lib/actions.js";
import { stepMethodName } from "@haibun/core/lib/step-registry.js";
import { acts, conduit, hasConduit, isServerUnreachable } from "./hypermedia.js";
import { pageMay } from "./page-key.js";

/** The monitor's step a page reports a diagnostic through. */
const CLIENT_LOG = { stepper: "MonitorStepper", step: "logClient" } as const;
export const CLIENT_LOG_METHOD = stepMethodName(CLIENT_LOG.stepper, CLIENT_LOG.step);
/** What reporting a diagnostic to actuality requires, which a page is delegated with what else it does. */
export const CLIENT_LOG_ACTION = requiredAction(CLIENT_LOG.stepper, CLIENT_LOG.step, {});
export type TClientLogLevel = "debug" | "info" | "warn" | "error";

/**
 * A failure a page caught so it doesn't stop what else the page is doing: it is reported to actuality, where a reader of the
 * run sees it beside actuality's events, and in development it also fails fast, so a test or a developer sees it at once.
 */
export function reportFailure(source: string, what: string, err: unknown): void {
	reportToRun("error", source, `${what}: ${errorDetail(err)}`);
	if (isDev()) throw err;
}

export function reportToRun(level: TClientLogLevel, source: string, message: string, attributes?: Record<string, unknown>): void {
	if (isOffline() || !hasConduit()) return;
	// A page that doesn't hold the report's action, as before its key holds what it was delegated, logs it to the console.
	if (!pageMay(CLIENT_LOG_ACTION)) return console.warn(`[${source}] not reported to actuality, since the page doesn't hold ${CLIENT_LOG_ACTION}: ${message}`, attributes);
	void conduit()
		.follow(acts(CLIENT_LOG_METHOD, { event: { level, source, message, attributes } }), `${source}: ${level}`)
		.catch((err: unknown) => {
			if (isServerUnreachable(err)) return console.warn(`[${source}] not reported to actuality: ${errorDetail(err)}`, { level, message });
			// The conduit let go of authority revoked or lapsed, so this report and later ones go to the console.
			if (authorityFailed(refusalCarried(err))) {
				return console.warn(`[${source}] not reported to actuality, since the page's authority failed verification: ${errorDetail(err)}`, { level, message });
			}
			failFastOrLog(`[${source}] reporting to actuality failed: ${errorDetail(err)}`, err);
		});
}
