/**
 * What a graph view shows, as a read of its axioms takes it, and the axioms of what it shows beside the view they state. The
 * axioms pane holds both, so it reads the same view again in another format, and the graph view's DL mode maps them onto its
 * scene.
 */
import { z } from "zod";
import { AccessQueryLevelSchema } from "@haibun/core/lib/domains/resources.js";
import { GraphAxiomsSchema } from "@haibun/core/lib/records/domains/axioms.js";

/** What a graph view shows: the records of each type it reads at a query level, the reader's choice of each type it shows or
 *  hides, the predicates whose edges it hides, whether it prunes the nodes an edge doesn't connect, and the moment its time cursor
 *  stands at where it doesn't show the live edge. */
export const GraphViewSchema = z
	.object({
		perTypeLimit: z.number().int(),
		accessLevel: AccessQueryLevelSchema,
		overrides: z.record(z.string(), z.boolean()),
		hiddenPredicates: z.array(z.string()),
		prune: z.boolean(),
		timeCursor: z.number().optional(),
	})
	.strict();
export type TGraphView = z.infer<typeof GraphViewSchema>;

/** The axioms of what a graph view shows, and the view they state as `graphView`: what `show axioms of {view}` returns. A domain that
 *  declares a component carries the hypermedia markers `id` and `view` on its products, so the view takes a name of its own. */
export const ViewAxiomsSchema = z.object({ ...GraphAxiomsSchema.shape, graphView: GraphViewSchema }).strict();
export type TViewAxioms = z.infer<typeof ViewAxiomsSchema>;
/** The same axioms and view as a step's products carry them, beside hypermedia markers that a reader doesn't read. */
export const ViewAxiomsProductsSchema = z.object(ViewAxiomsSchema.shape);
