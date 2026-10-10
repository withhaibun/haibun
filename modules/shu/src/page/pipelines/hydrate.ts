/**
 * Reads the page's hydration: what the site served the page with, or the record of actuality the page carries. The page
 * parses its hydration element by `HydrationSchema` once, at its start, and the element is emptied, so the page doesn't
 * hold the record twice.
 */
import { jsonCarried } from "@haibun/core/lib/json-text.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import type { TActualityId } from "@haibun/core/lib/rpc-wire.js";
import { HydrationSchema, type TDeploymentSettings, type THydration } from "../../domains/hydration.js";
import type { THydrationElement, THydrationRead } from "../ports.js";

/** Returns the page's hydration as `element` holds it. Throws where the element holds text that isn't JSON, or JSON that
 *  `HydrationSchema` refuses, and names each refused field. */
export function readHydration(element: THydrationElement): THydrationRead {
	const text = element.take();
	let hydration: THydration | undefined;
	if (text !== undefined) {
		const parsed = HydrationSchema.safeParse(jsonCarried(text));
		if (!parsed.success) throw new Error(`the page's hydration doesn't match its schema: ${errorDetail(parsed.error)}`);
		hydration = parsed.data;
	}
	const served = (): TDeploymentSettings => {
		const settings = hydration?.settings;
		if (settings === undefined) throw new Error("this page wasn't served with its deployment's settings: a site's ShuStepper writes them into the page it serves");
		return settings;
	};
	return {
		actualityId: (): TActualityId => {
			if (hydration === undefined) throw new Error("this page wasn't served with the actualityId of the records it reads, so it doesn't make a call");
			return hydration.actualityId;
		},
		carried: () => hydration?.cache,
		opensAt: () => hydration?.viewHash,
		carriedProducts: (method) => hydration?.viewProducts?.[method],
		settings: served,
		askToolLimit: () => hydration?.settings?.askToolLimit,
	};
}
