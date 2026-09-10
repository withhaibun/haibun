/**
 * external-components: load a site-declared component bundle by its custom-element tag. A concern that ships its own
 * element declares `ui: { component, js }`; this resolves the tag through the ui catalog (getUiByComponent), imports the
 * script, and verifies the element registered. The ONE loader for every mount path: a column pane (app.ts) and an
 * embedded product view (shu-product-view) load a component identically, so an embed can never depend on some column
 * having loaded the bundle first. Callers pass a reporter to route lifecycle phases to their diagnostic channel.
 */
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { getUiByComponent } from "./rels-cache.js";

export type TExternalComponentPhase = "lookup" | "fetch" | "register" | "missing-ui" | "missing-script" | "fetch-failed" | "register-failed" | "mounted";
export type TExternalComponentReporter = (level: "debug" | "error", phase: TExternalComponentPhase, component: string, extra?: Record<string, unknown>) => void;

const silent: TExternalComponentReporter = () => undefined;

export async function ensureUiComponentLoaded(childTag: string, report: TExternalComponentReporter = silent): Promise<void> {
	if (customElements.get(childTag)) {
		report("debug", "register", childTag, { "haibun.shu.external-component.already-registered": true });
		return;
	}
	report("debug", "lookup", childTag);
	const ui = getUiByComponent(childTag);
	if (!ui) {
		report("error", "missing-ui", childTag);
		throw new Error(`[shu] no concern declares ui.component "${childTag}", register a domain with ui:{component,js}`);
	}
	const js = typeof ui.js === "string" ? ui.js : "";
	if (!js) {
		report("error", "missing-script", childTag);
		throw new Error(`[shu] concern for ${childTag} has no ui.js script URL`);
	}
	const src = js.startsWith("/") ? js : `/${js}`;
	report("debug", "fetch", childTag, { "haibun.shu.external-component.url": src });
	try {
		await import(src);
	} catch (err) {
		const error = errorDetail(err);
		report("error", "fetch-failed", childTag, { "haibun.shu.external-component.url": src, error });
		throw new Error(`[shu] failed to fetch ${src} for ${childTag}: ${error}`);
	}
	if (!customElements.get(childTag)) {
		report("error", "register-failed", childTag, { "haibun.shu.external-component.url": src });
		throw new Error(`[shu] ${childTag} loaded from ${src} but customElements.get(${JSON.stringify(childTag)}) is undefined, bundle did not register the element`);
	}
	report("debug", "mounted", childTag, { "haibun.shu.external-component.url": src });
}
