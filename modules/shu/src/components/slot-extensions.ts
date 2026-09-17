/**
 * The UI extensions a consumer declares for slots of the page's chrome, loaded from where each is served. A missing or
 * unserved extension is reported by itself, and the others load.
 */
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { whenSiteMetadataReady } from "../rels-cache.js";
import { reportToRun, type TClientLogLevel } from "../client-log.js";

/** Load each extension declared for one of the slots, telling the component after each loads, and throw naming every one
 *  that didn't load. */
export async function loadSlotExtensions(source: string, slots: ReadonlyArray<string>, apiBase: string, onLoaded: () => void): Promise<void> {
	const report = (level: TClientLogLevel, message: string, attributes: Record<string, unknown> = {}): void =>
		reportToRun(level, source, message, {
			"haibun.shu.slot-extension.event": "ui-extension",
			...attributes,
			...(level === "error"
				? { "haibun.autonomic.event": "step.failure", "exception.type": "SlotUiExtension", "exception.message": typeof attributes.error === "string" ? attributes.error : message }
				: {}),
		});
	// The concern catalog populates the site metadata after a component connects, so the slots are read once it has.
	const meta = await whenSiteMetadataReady();
	const slotted = Object.entries(meta.ui).filter(([, ui]) => slots.includes(String(ui.slot)) && ui.js);
	report("debug", `${slotted.length} slot extensions found`, { count: slotted.length });
	const errors: string[] = [];
	for (const [label, ui] of slotted) {
		const raw = String(ui.js);
		const jsUrl = raw.startsWith("http") || raw.startsWith("/") ? raw : `${apiBase}/${raw}`;
		try {
			await import(jsUrl);
			onLoaded();
			report("debug", `loaded slot extension for ${label}`, { label, jsUrl });
		} catch (e) {
			const message = `Failed to load UI extension for ${label} from ${jsUrl}: ${errorDetail(e)}`;
			report("error", message, { label, jsUrl, error: errorDetail(e) });
			errors.push(message);
		}
	}
	if (errors.length > 0) throw new Error(errors.join("\n"));
}
