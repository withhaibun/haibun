/**
 * Loads a component a concern declares by its tag (`ui: { component, js }`): the concern catalog names the script, the
 * element registry imports it, and the load reports each phase to actuality. A column pane, an embedded product view and
 * the graph presenter load a component through this one pipeline, so an embedded view doesn't depend on a pane that
 * loaded the script first.
 */
import { errorDetail } from "@haibun/core/lib/domains/util.js";
import { uiOfComponent, type TCatalog } from "../derivations/catalog.js";
import { reportToRun } from "../../client-log.js";
import type { TElements } from "../ports.js";

/** The source a load reports under. */
const COMPONENT_LOAD_SOURCE = "shu-app";

/** The phases of a load, as a report names them. */
type TLoadPhase = "lookup" | "fetch" | "already-defined" | "missing-ui" | "missing-script" | "load-failed" | "mounted";

/** Reports a phase of the load of `component` to actuality. A failed phase is reported as a step failure, which a
 *  consumer's autonomic loop reads from any source. */
function report(level: "debug" | "error", phase: TLoadPhase, component: string, extra: Record<string, unknown>): void {
	const message = `external-component ${component}: ${phase}${extra.error ? `, ${String(extra.error)}` : ""}`;
	const attributes: Record<string, unknown> = { "haibun.shu.external-component.phase": phase, "haibun.shu.external-component.name": component, ...extra };
	if (level === "error") Object.assign(attributes, { "haibun.autonomic.event": "step.failure", "exception.type": "ExternalComponentFailure", "exception.message": message });
	reportToRun(level, COMPONENT_LOAD_SOURCE, message, attributes);
}

/** Fails the load of `component` at `phase`: reports it, and throws `message`. */
function refuse(phase: TLoadPhase, component: string, message: string, extra: Record<string, unknown>): never {
	report("error", phase, component, { ...extra, error: message });
	throw new Error(message);
}

/** Loads the script of the component `tag` that a concern of `catalog` declares, through `elements`. Resolves once the element
 *  is defined. Throws where the concerns don't declare the component, where its declaration doesn't name a script, and where
 *  the script fails to load or doesn't define the element. */
export async function loadDeclaredComponent(elements: TElements, catalog: () => TCatalog, tag: string): Promise<void> {
	if (elements.isDefined(tag)) {
		report("debug", "already-defined", tag, {});
		return;
	}
	report("debug", "lookup", tag, {});
	const ui = uiOfComponent(catalog(), tag);
	if (!ui) refuse("missing-ui", tag, `the concerns don't declare ui.component "${tag}". A domain declares its component with ui: { component, js }`, {});
	const js = ui.js;
	if (typeof js !== "string" || js === "") refuse("missing-script", tag, `the concern that declares <${tag}> doesn't name its script in ui.js`, {});
	const script = js.startsWith("/") ? js : `/${js}`;
	const at = { "haibun.shu.external-component.url": script };
	report("debug", "fetch", tag, at);
	try {
		await elements.load(tag, script);
	} catch (err) {
		refuse("load-failed", tag, `the script ${script} of <${tag}> failed to load: ${errorDetail(err)}`, at);
	}
	report("debug", "mounted", tag, at);
}
