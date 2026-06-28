// Control steps for the graph query view, co-located with shu-graph-query so its controls stay with the
// component rather than accreting into a central stepper.
import { z } from "zod";
import { AStepper, type IHasCycles, type IStepperCycles, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import { DOMAIN_PERSISTED_TYPE, type TDomainDefinition } from "@haibun/core/lib/resources.js";
import { actionOKWithProducts } from "@haibun/core/lib/util/index.js";
import { ViewQueryControlSchema } from "./shu-graph-query.controls-schema.js";

// productsDomain for view-query controls; its ui.component routes the product to the live shu-graph-query,
// whose `set products()` applies it to the viewQuery store.
const VIEW_QUERY = "view-query";
export const DOMAIN_SEARCH_TEXT = "search-text";
export const DOMAIN_SORT_FIELD = "sort-field";

const viewQueryDomains: TDomainDefinition[] = [
	{ selectors: [VIEW_QUERY], schema: ViewQueryControlSchema, description: "A change to the graph query view — type, text search, or sort", ui: { component: "shu-graph-query" } },
	{ selectors: [DOMAIN_SEARCH_TEXT], schema: z.string().min(1), description: "Free-text search over the current type's indexed fields" },
	{ selectors: [DOMAIN_SORT_FIELD], schema: z.string().min(1), description: "A sortable field of the current type" },
];

/**
 * Each step produces a `view-query` control product — a partial query — that shu-graph-query's `set products()`
 * applies to the viewQuery store. The gwta is natural and reusable, and composes with `set {what} from
 * {statement}`: because each step produces a product, a feature can capture or chain it
 * (e.g. `set saved from [search for "INBOX"]`).
 */
export default class ShuGraphQueryControls extends AStepper implements IHasCycles {
	cycles: IStepperCycles = { getConcerns: () => ({ domains: viewQueryDomains }) };

	steps = {
		searchFor: {
			gwta: `search for {q: ${DOMAIN_SEARCH_TEXT}}`,
			productsDomain: VIEW_QUERY,
			action: ({ q }: { q: string }) => actionOKWithProducts(ViewQueryControlSchema.parse({ q })),
		},
		viewType: {
			gwta: `view {label: ${DOMAIN_PERSISTED_TYPE}}`,
			productsDomain: VIEW_QUERY,
			action: ({ label }: { label: string }) => actionOKWithProducts(ViewQueryControlSchema.parse({ label })),
		},
		sortBy: {
			gwta: `sort by {sort: ${DOMAIN_SORT_FIELD}}`,
			productsDomain: VIEW_QUERY,
			action: ({ sort }: { sort: string }) => actionOKWithProducts(ViewQueryControlSchema.parse({ sort })),
		},
	} satisfies TStepperSteps;
}
