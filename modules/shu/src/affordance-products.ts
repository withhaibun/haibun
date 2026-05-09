import { z } from "zod";
import { HYPERMEDIA } from "@haibun/core/schema/protocol.js";
import { SHU_TYPE } from "./consts.js";

const PRODUCT_KEY = {
	ID: "id",
	VIEW: "view",
	COMPONENT: "_component",
	PRODUCTS: "products",
} as const;

const ProductSchema = z.looseObject({
	[PRODUCT_KEY.ID]: z.string().optional(),
	[PRODUCT_KEY.VIEW]: z.string().optional(),
	[PRODUCT_KEY.COMPONENT]: z.string().optional(),
	[HYPERMEDIA.TYPE]: z.string().optional(),
	[HYPERMEDIA.SUMMARY]: z.string().optional(),
});

const ProductWithViewSchema = ProductSchema.extend({ [PRODUCT_KEY.VIEW]: z.string() });

/** Envelope subtype for payloads that carry products containing a concrete view. */
export const HasProductsWithViewSchema = z.looseObject({ [PRODUCT_KEY.PRODUCTS]: z.unknown() }).transform((value, ctx) => {
	const rec = findAffordanceRecord(value[PRODUCT_KEY.PRODUCTS]);
	const parsed = ProductWithViewSchema.safeParse(rec);
	if (!parsed.success) {
		ctx.addIssue({ code: z.ZodIssueCode.custom, message: "products must contain an affordance product with view" });
		return z.NEVER;
	}
	return { ...value, [PRODUCT_KEY.PRODUCTS]: parsed.data };
});

export type TAffordanceView = { id: string; description: string; component: string };

export type TAffordanceProductAction =
	| { kind: "none" }
	| { kind: "close"; view: string }
	| { kind: "open-component"; view: string; component: string; label: string }
	| { kind: "open-type"; id: string; type: string; label: string }
	| { kind: "show-views"; views: TAffordanceView[]; label: string };

const asRecord = (value: unknown): Record<string, unknown> | undefined => (value && typeof value === "object" ? (value as Record<string, unknown>) : undefined);

const requiredString = (value: unknown, message: string): string => {
	if (typeof value !== "string") throw new Error(message);
	return value;
};

const hasAffordanceMarkers = (value: Record<string, unknown>): boolean => {
	const typeStr = value[HYPERMEDIA.TYPE];
	return typeof value[PRODUCT_KEY.VIEW] === "string" || typeof value[PRODUCT_KEY.COMPONENT] === "string" || typeof typeStr === "string";
};

const findAffordanceRecord = (value: unknown, depth = 0): Record<string, unknown> | undefined => {
	if (depth > 8) return undefined;
	const rec = asRecord(value);
	if (!rec) return undefined;
	if (hasAffordanceMarkers(rec)) return rec;
	for (const nested of Object.values(rec)) {
		const found = findAffordanceRecord(nested, depth + 1);
		if (found) return found;
	}
	return undefined;
};

/** Parse product shapes relevant to affordance open/close actions. */
export function parseAffordanceProduct(product: unknown): TAffordanceProductAction {
	const envelope = HasProductsWithViewSchema.safeParse(product);
	const candidate = (envelope.success ? envelope.data[PRODUCT_KEY.PRODUCTS] : findAffordanceRecord(product)) ?? asRecord(product);
	if (!candidate) return { kind: "none" };
	const parsed = ProductSchema.parse(candidate);
	const typeStr = parsed[HYPERMEDIA.TYPE];
	if (!hasAffordanceMarkers(parsed)) return { kind: "none" };
	if (typeStr === SHU_TYPE.CLOSE_VIEW) {
		return { kind: "close", view: requiredString(parsed[PRODUCT_KEY.VIEW], "Affordance close product requires string view") };
	}
	if (typeStr === SHU_TYPE.VIEW_COLLECTION) {
		const rawViews = (candidate as { views?: unknown }).views;
		if (!Array.isArray(rawViews)) throw new Error("Affordance view-collection product requires array views");
		const views: TAffordanceView[] = rawViews.map((v) => {
			const r = asRecord(v) ?? {};
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
		// `id` carries a per-instance identity for multi-pane components (e.g. fisheye uses
		// `<component>:<uuid>`). Singleton views (graph, monitor, sequence) only set `view`.
		// Either form is sufficient — prefer `id`, fall back to `view`.
		const idOrView = parsed[PRODUCT_KEY.ID] ?? parsed[PRODUCT_KEY.VIEW];
		const view = requiredString(idOrView, "Affordance component product requires string id or view");
		const summary = parsed[HYPERMEDIA.SUMMARY];
		const label = typeof summary === "string" ? summary : component;
		return { kind: "open-component", view, component, label };
	}
	if (typeof typeStr === "string" && typeof parsed[PRODUCT_KEY.ID] === "string") {
		const id = requiredString(parsed[PRODUCT_KEY.ID], "Affordance type product requires string id");
		const summary = parsed[HYPERMEDIA.SUMMARY];
		const label = typeof summary === "string" ? summary : typeStr;
		return { kind: "open-type", id, type: typeStr, label };
	}
	if (typeof parsed[PRODUCT_KEY.VIEW] === "string") throw new Error(`Unexpected view-only product shape: ${parsed[PRODUCT_KEY.VIEW]}`);
	return { kind: "none" };
}
