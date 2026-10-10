/** States a script the page's Content-Security-Policy (`scriptSources`) refused: what was refused, under which directive, and where. */
import type { TRefusedScript } from "../ports.js";

/** How a page runs a script, as a refusal states it. */
export const HOW_SCRIPTS_RUN =
	"a page runs the script shu serves with it, and each script that script loads, as a component a concern declares by its ui.js; an inline script, an event handler attribute and a script added other than by loading it don't run";

/** What the browser reports as refused other than a script's address, by the keyword it reports. */
const REFUSED_KEYWORDS = new Map([["inline", "an inline script or event handler attribute"], ["eval", "code built from text"], ["wasm-eval", "WebAssembly"]]);

/** What a refusal refused, by the keyword or the address the browser reports for it. */
function refusedWhat(blockedURI: string): string {
	const keyword = REFUSED_KEYWORDS.get(blockedURI);
	return keyword === undefined ? `the script at ${blockedURI}` : keyword;
}

/** The failure a refusal reports: what was refused, under which directive, and where. */
export const refusal = (event: TRefusedScript): string =>
	`the page's Content-Security-Policy (${event.effectiveDirective}) refused ${refusedWhat(event.blockedURI)}${event.sourceFile ? ` in ${event.sourceFile}:${event.lineNumber}` : ""}`;
