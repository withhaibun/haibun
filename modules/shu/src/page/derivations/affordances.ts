/**
 * The affordance a step's products state, and the pane operations a batch of step ends states. A product that names a
 * view or a component opens that view, and a view collection offers its views in a picker. Only a step a reader sees in
 * the log opens a view: a hidden substep, at the trace level the log hides, and a view's own read of its data can return
 * a product that names a view, and a reader didn't request either. A reader's own call of a step opens its view from the
 * response (`page/controllers/affordance-dispatch.ts`).
 */
import { z } from "zod";
import { HYPERMEDIA, SUBSTEP_LEVEL, type THaibunEvent, type THypermediaProducts } from "@haibun/core/schema/protocol.js";
import { SHU_TYPE } from "../../domains/elements.js";
import type { TEvent } from "../ports.js";

const PRODUCT_KEY = { ID: "id", VIEW: "view", COMPONENT: "_component", PRODUCTS: "products" } as const;

const ProductSchema = z.looseObject({
	[PRODUCT_KEY.ID]: z.string().optional(),
	[PRODUCT_KEY.VIEW]: z.string().optional(),
	[PRODUCT_KEY.COMPONENT]: z.string().optional(),
	[HYPERMEDIA.TYPE]: z.string().optional(),
	[HYPERMEDIA.SUMMARY]: z.string().optional(),
});

const ProductWithViewSchema = ProductSchema.extend({ [PRODUCT_KEY.VIEW]: z.string() });

/** Parses a `{ products }` envelope whose products contain an affordance product with a string `view`. */
const HasProductsWithViewSchema = z.looseObject({ [PRODUCT_KEY.PRODUCTS]: z.unknown() }).transform((value, ctx) => {
	const rec = findAffordanceRecord(value[PRODUCT_KEY.PRODUCTS], 0);
	const parsed = ProductWithViewSchema.safeParse(rec);
	if (!parsed.success) {
		ctx.addIssue({ code: z.ZodIssueCode.custom, message: "products must contain an affordance product with view" });
		return z.NEVER;
	}
	return { ...value, [PRODUCT_KEY.PRODUCTS]: parsed.data };
});

export type TAffordanceView = { id: string; description: string; component: string };

type TAffordanceProductAction =
	| { kind: "none" }
	| { kind: "open-component"; view: string; component: string; label: string; products: Record<string, unknown> }
	| { kind: "show-views"; views: TAffordanceView[]; label: string };

/** True for a non-null object or array. The parser reads the fields of each one. */
const isFields = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object";
const asRecord = (value: unknown): Record<string, unknown> | undefined => (isFields(value) ? value : undefined);

const requiredString = (value: unknown, message: string): string => {
	if (typeof value !== "string") throw new Error(message);
	return value;
};

/** True where a product is an instruction to open a view: it has a string `view` or `_component`, or its `_type` is the
 *  view-collection type. Any other `_type` states what a record is and isn't an instruction. Reading it as one would
 *  open a column for every step that returns a record, including each read a view makes to render itself. A reader
 *  then couldn't close a column that their own view reopens. */
const hasAffordanceMarkers = (value: Record<string, unknown>): boolean => {
	const typeStr = value[HYPERMEDIA.TYPE];
	return typeof value[PRODUCT_KEY.VIEW] === "string" || typeof value[PRODUCT_KEY.COMPONENT] === "string" || typeStr === SHU_TYPE.VIEW_COLLECTION;
};

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

/** Parses a product into its affordance action: `open-component`, `show-views` or `none`. Throws on a malformed
 *  affordance product. */
export function parseAffordanceProduct(product: unknown): TAffordanceProductAction {
	const envelope = HasProductsWithViewSchema.safeParse(product);
	const candidate = (envelope.success ? envelope.data[PRODUCT_KEY.PRODUCTS] : findAffordanceRecord(product, 0)) ?? asRecord(product);
	if (!candidate) return { kind: "none" };
	const parsed = ProductSchema.parse(candidate);
	const typeStr = parsed[HYPERMEDIA.TYPE];
	if (!hasAffordanceMarkers(parsed)) return { kind: "none" };
	if (typeStr === SHU_TYPE.VIEW_COLLECTION) {
		const rawViews = (candidate as { views?: unknown }).views;
		if (!Array.isArray(rawViews)) throw new Error("Affordance view-collection product requires array views");
		const views: TAffordanceView[] = rawViews.map((v) => {
			const r = asRecord(v);
			if (!r) throw new Error("a view-collection entry is an object with an id, a description and a component");
			return {
				id: requiredString(r.id, "view-collection entry requires string id"),
				description: requiredString(r.description, "view-collection entry requires string description"),
				component: requiredString(r.component, "view-collection entry requires string component"),
			};
		});
		const summary = parsed[HYPERMEDIA.SUMMARY];
		return { kind: "show-views", views, label: typeof summary === "string" ? summary : "Available Views" };
	}
	if (typeof parsed[PRODUCT_KEY.COMPONENT] === "string") {
		const component = requiredString(parsed[PRODUCT_KEY.COMPONENT], "Affordance component product requires string _component");
		// A multi-pane component's product holds a per-instance identity in `id`. A clustered viewer's `id` is
		// `<component>:<uuid>`. A product without `id` uses `view` as the id.
		const idOrView = parsed[PRODUCT_KEY.ID] ?? parsed[PRODUCT_KEY.VIEW];
		const view = requiredString(idOrView, "Affordance component product requires string id or view");
		const summary = parsed[HYPERMEDIA.SUMMARY];
		const label = typeof summary === "string" ? summary : component;
		return { kind: "open-component", view, component, label, products: candidate };
	}
	if (typeof parsed[PRODUCT_KEY.VIEW] === "string") throw new Error(`Affordance product with view ${parsed[PRODUCT_KEY.VIEW]} requires string _component`);
	return { kind: "none" };
}

/** The pane operation of a step end: a component to open, or a view collection's picker. */
type TPaneOp = { op: "component"; tag: string; label: string; data: Record<string, unknown> } | { op: "views-picker"; views: TAffordanceView[]; label: string };

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
		if (action.kind === "open-component") ops.set(action.component, { op: "component", tag: action.component, label: action.label, data: action.products });
		else if (action.kind === "show-views") ops.set("views", { op: "views-picker", views: action.views, label: action.label });
	}
	return ops;
}
