/**
 * The affordance a step's products state, and the pane operations a batch of step ends states. A product that names a
 * view or a component opens that view. Only a step a reader sees in
 * the log opens a view: a hidden substep, at the trace level the log hides, and a view's own read of its data can return
 * a product that names a view, and a reader didn't request either. A reader's own call of a step opens its view from the
 * response (`page/controllers/affordance-dispatch.ts`).
 */
import { z } from "zod";
import { HYPERMEDIA, SUBSTEP_LEVEL, type THaibunEvent, type THypermediaProducts } from "@haibun/core/lib/domains/protocol.js";
import type { TEvent } from "../ports.js";

/** The key of a `{ products }` envelope's products. */
const PRODUCTS_KEY = "products";

const ProductSchema = z.looseObject({ [HYPERMEDIA.COMPONENT]: z.string().optional(), [HYPERMEDIA.VIEW]: z.string().optional(), [HYPERMEDIA.SUMMARY]: z.string().optional() });

type TAffordanceProductAction = { kind: "none" } | { kind: "open-component"; view: string; component: string; label: string; products: Record<string, unknown> };

/** True for a non-null object or array. The parser reads the fields of each one. */
const isFields = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object";
const asRecord = (value: unknown): Record<string, unknown> | undefined => (isFields(value) ? value : undefined);

/** True where a product is an instruction to open a view: it has a string `_component` or `_view`. A `_type` states what a
 *  record is and isn't an instruction. Reading it as one would open a column for every step that returns a record,
 *  including each read a view makes to render itself. A reader then couldn't close a column that their own view reopens. */
const hasAffordanceMarkers = (value: Record<string, unknown>): boolean => typeof value[HYPERMEDIA.COMPONENT] === "string" || typeof value[HYPERMEDIA.VIEW] === "string";

/** How deep in a product's nested objects the parser looks for an affordance. */
const AFFORDANCE_DEPTH = 8;

/** Returns the first object in `value`, at most `AFFORDANCE_DEPTH` levels deep, that states an affordance. */
const findAffordanceRecord = (value: unknown, depth: number): Record<string, unknown> | undefined => {
	if (depth > AFFORDANCE_DEPTH) return undefined;
	const rec = asRecord(value);
	if (!rec) return undefined;
	if (hasAffordanceMarkers(rec)) return rec;
	for (const nested of Object.values(rec)) {
		const found = findAffordanceRecord(nested, depth + 1);
		if (found) return found;
	}
	return undefined;
};

/** Parses a product, or a `{ products }` envelope, into its affordance action: `open-component` or `none`. Throws on a
 *  product that names its component or its pane without the other. */
export function parseAffordanceProduct(product: unknown): TAffordanceProductAction {
	const enveloped = asRecord(product)?.[PRODUCTS_KEY];
	const candidate = findAffordanceRecord(enveloped, 0) ?? findAffordanceRecord(product, 0);
	if (!candidate) return { kind: "none" };
	const { [HYPERMEDIA.COMPONENT]: component, [HYPERMEDIA.VIEW]: view, [HYPERMEDIA.SUMMARY]: summary } = ProductSchema.parse(candidate);
	if (component === undefined || view === undefined)
		throw new Error(
			`an affordance product states both ${HYPERMEDIA.COMPONENT} and ${HYPERMEDIA.VIEW}, and this one states ${component === undefined ? HYPERMEDIA.VIEW : HYPERMEDIA.COMPONENT} alone`,
		);
	return { kind: "open-component", view, component, label: summary ?? component, products: candidate };
}

/** The pane operation of a step end: a component to open. */
type TPaneOp = { tag: string; label: string; data: Record<string, unknown> };

/** Returns the pane operation of each step end in `events` that a reader sees, by pane: the latest operation for each
 *  pane, in the order each pane first appears. The event stream sends only what happens after a page connects, so each
 *  event is live, and a view a reader closed opens again only where actuality returns it again. */
export function paneOpsFor(events: TEvent[]): Map<string, TPaneOp> {
	const ops = new Map<string, TPaneOp>();
	for (const event of events) {
		const e = event as THaibunEvent & { products?: THypermediaProducts };
		if (e.kind !== "lifecycle" || e.type !== "step" || e.stage !== "end" || e.status !== "completed" || !e.products) continue;
		if (e.level === SUBSTEP_LEVEL) continue;
		const action = parseAffordanceProduct(e.products);
		if (action.kind === "open-component") ops.set(action.component, { tag: action.component, label: action.label, data: action.products });
	}
	return ops;
}
