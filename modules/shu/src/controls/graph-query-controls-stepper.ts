/** Controls for the graph query view: what a reader searches, the type it views, its sort, and the individuals it lists. */
import type { Page } from "playwright";
import { AStepper, type IHasCycles, type IStepperCycles, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import { DOMAIN_PERSISTED_TYPE, type TDomainDefinition } from "@haibun/core/lib/domains/resources.js";
import { actionOK, actionNotOK, actionOKWithProducts } from "@haibun/core/lib/domains/util.js";
import { DOMAIN_RECORD_ID, NameSchema } from "@haibun/core/lib/domains/domains.js";
import { SHU_TAG } from "../domains/elements.js";
import { ViewQueryControlSchema } from "./domains/view-query-control.js";
import { ROUND_TRIP_MS } from "./domains/waits.js";
import { findsAtLeast } from "./pipelines/page-reads.js";
import { controlled } from "./root.js";

// productsDomain for view-query controls; its ui.component routes the product to the live shu-graph-query,
// whose `set products()` applies it to the viewQuery store.
const VIEW_QUERY = "view-query";
// How long a witness gives a record to reach the table: a live record crosses the server, the event stream and a trailing
// pause before the view reads again.
const DOMAIN_SEARCH_TEXT = "search-text";
const DOMAIN_SORT_FIELD = "sort-field";

const viewQueryDomains: TDomainDefinition[] = [
	{ selectors: [VIEW_QUERY], schema: ViewQueryControlSchema, description: "A change to the graph query view, type, text search, or sort", ui: { component: SHU_TAG.GRAPH_QUERY } },
	{ selectors: [DOMAIN_SEARCH_TEXT], schema: NameSchema, description: "Free-text search over the current type's indexed fields" },
	{ selectors: [DOMAIN_SORT_FIELD], schema: NameSchema, description: "A sortable field of the current type" },
];

/**
 * Each step produces a `view-query` control product, a partial query, that shu-graph-query's `set products()`
 * applies to the viewQuery store. The gwta is natural and reusable, and composes with `set {what} from
 * {statement}`: because each step produces a product, a feature can capture or chain it
 * (e.g. `set saved from [search for "INBOX"]`).
 */
export default class ShuGraphQueryControls extends AStepper implements IHasCycles {
	description = "Drives the graph query view in a page: searches, chooses a type, sorts, and checks which individuals the query lists.";
	cycles: IStepperCycles = { getConcerns: () => ({ domains: viewQueryDomains }) };

	/** The page this control drives. */
	private page(): Promise<Page> {
		return controlled(this).page();
	}

	steps = {
		queryLists: {
			// The streamed-arrival witness: a record written while the page is open is a row of the table the query matches,
			// and the view reads again to place it. Waits for the row rather than for a length of time. The row carries the
			// listed individual's id, so the match never depends on how a cell renders or truncates a value. The phrase names
			// the individual so a sentence about querying in a feature's prose is not read as this step.
			gwta: `query lists the {label: ${DOMAIN_PERSISTED_TYPE}} individual {id: ${DOMAIN_RECORD_ID}}`,
			recordIds: { id: "label" },
			action: async ({ label, id }: { label: string; id: string }) => {
				const row = (await this.page()).locator(`[data-persisted-as=${JSON.stringify(label)}][data-individual-id=${JSON.stringify(id)}]`);
				return (await findsAtLeast(row, 1, ROUND_TRIP_MS)) ? actionOK() : actionNotOK(`the query never listed the ${label} "${id}"`);
			},
		},
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
	} as const satisfies TStepperSteps;
}
