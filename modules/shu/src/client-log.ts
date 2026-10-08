import { isOffline } from "./rpc-registry.js";
import { authorityFailed, refusalCarried } from "@haibun/core/lib/rpc-wire.js";
/**
 * The page's diagnostic channel to actuality. A page reports a diagnostic to actuality through the monitor's client-log
 * step. A page doesn't report a diagnostic without a server or a conduit to one. A report is such a page. A page writes the
 * diagnostic to the browser console where it doesn't hold the step's action or its authority fails verification. The call
 * writes a warning to the browser console and returns where the server isn't reachable. Any other failure is an RPC fault.
 * It would hide every later diagnostic, so it throws in development and is logged to the console otherwise.
 *
 * A view sends the occurrences it records at their own rate to the blip channel (client-blips.ts). This channel carries
 * the few diagnostics a reader of actuality reads beside actuality's own events.
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
/** The action that reporting a diagnostic to actuality requires. A page is delegated this action with its other actions. */
export const CLIENT_LOG_ACTION = requiredAction(CLIENT_LOG.stepper, CLIENT_LOG.step, {});
export type TClientLogLevel = "debug" | "info" | "warn" | "error";

/**
 * Reports a failure the page caught, so the failure doesn't stop the page's other work. The failure is reported to
 * actuality, where a reader reads it beside actuality's events. In development it also throws, so a test or a developer
 * sees it at once.
 */
export function reportFailure(source: string, what: string, err: unknown): void {
	reportToRun("error", source, `${what}: ${errorDetail(err)}`);
	if (isDev()) throw err;
}

export function reportToRun(level: TClientLogLevel, source: string, message: string, attributes?: Record<string, unknown>): void {
	if (isOffline() || !hasConduit()) return;
	// A page that doesn't hold the report's action logs the diagnostic to the console, as before its key holds its delegated actions.
	if (!pageMay(CLIENT_LOG_ACTION)) return console.warn(`[${source}] not reported to actuality, since the page doesn't hold ${CLIENT_LOG_ACTION}: ${message}`, attributes);
	void conduit()
		.follow(acts(CLIENT_LOG_METHOD, { event: { level, source, message, attributes } }), `${source}: ${level}`)
		.catch((err: unknown) => {
			if (isServerUnreachable(err)) return console.warn(`[${source}] not reported to actuality: ${errorDetail(err)}`, { level, message });
			// The conduit discards a revoked or expired page authority (forgetPageAuthority), so this report and later reports are
			// written to the console.
			if (authorityFailed(refusalCarried(err))) {
				return console.warn(`[${source}] not reported to actuality, since the page's authority failed verification: ${errorDetail(err)}`, { level, message });
			}
			failFastOrLog(`[${source}] reporting to actuality failed: ${errorDetail(err)}`, err);
		});
}
