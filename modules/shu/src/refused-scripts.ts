/**
 * The scripts a page's Content-Security-Policy refused to run (`scriptSources`), reported to actuality as failures that
 * state what was refused, where, and how a script runs here, so a component that doesn't load states why.
 */
import { reportFailure } from "./client-log.js";

/** The source a refused script is reported under. */
const REFUSED_SCRIPTS_SOURCE = "content-security-policy";

/** How a page runs a script, as a refusal states it. */
export const HOW_SCRIPTS_RUN =
	"a page runs the script shu serves with it, and each script that script loads, as a component a concern declares by its ui.js; an inline script, an event handler attribute and a script added other than by loading it don't run";

/** What a refusal refused, by the address the browser reports for it. */
const refusedWhat = (blockedURI: string): string =>
	({ inline: "an inline script or event handler attribute", eval: "code built from text", "wasm-eval": "WebAssembly" })[blockedURI] ?? `the script at ${blockedURI}`;

/** The failure a refusal reports: what was refused, under which directive, and where. */
export const refusal = (event: Pick<SecurityPolicyViolationEvent, "blockedURI" | "effectiveDirective" | "sourceFile" | "lineNumber">): string =>
	`the page's Content-Security-Policy (${event.effectiveDirective}) refused ${refusedWhat(event.blockedURI)}${event.sourceFile ? ` in ${event.sourceFile}:${event.lineNumber}` : ""}`;

/** Report each script the page's policy refuses, from the page's start. */
export function reportRefusedScripts(): void {
	document.addEventListener("securitypolicyviolation", (event) => reportFailure(REFUSED_SCRIPTS_SOURCE, refusal(event), new Error(HOW_SCRIPTS_RUN)));
}
