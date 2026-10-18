/**
 * The UI extensions a consumer declares for slots of the page's chrome, loaded from where each is served. A missing or
 * unserved extension is reported by itself, and the others load.
 */
import { errorDetail } from "@haibun/core/lib/domains/util.js";
import { slotExtensions } from "../controllers/catalog-controller.js";
import { getAvailableSteps } from "../controllers/registry-controller.js";
import { reportToRun } from "../controllers/client-log-controller.js";
import type { TClientLogLevel } from "../ports.js";

/** Load each extension declared for one of the slots, notifying the component after each loads, and throw naming every one
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
	// The concern catalog arrives with actuality's steps, after a component connects, so the slots are read once it has.
	await getAvailableSteps();
	const slotted = slotExtensions(slots);
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
