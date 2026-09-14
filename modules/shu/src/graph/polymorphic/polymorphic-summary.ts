/**
 * What a graph states about itself to a reader who is not looking at it.
 *
 * A graph is any size, and a summary carrying every statement of a thousand-node graph is one no model's window holds.
 * The scene is the only thing that knows what the reader is on, so it answers with the statements about that node
 * first, then the rest in the order it drew them, up to what a summary holds. The summary states how many statements
 * the graph has and names the step that reads them all, so a reader told 200 of 1200 asks for the rest rather than
 * answering from a part it cannot tell is partial.
 */
import { linkTo } from "../../rpc-registry.js";
import { stepMethodName } from "@haibun/core/lib/step-registry.js";

/** How many statements a graph's summary holds. */
export const GRAPH_SUMMARY_STATEMENTS = 200;
/** The stepper whose steps answer a page's reads of the graph, and the step that reads every statement one draws. */
const GRAPH_SOURCE_STEPPER = "GraphSourceStepper";
const GET_CLUSTERED_QUADS = "getClusteredQuads";

type TStated = { subject: string; predicate: string; object: unknown; namedGraph: string };

/** The graph's own JSON-LD, bounded to what a summary holds, with what it left out named. `on` is the node the reader
 *  is on, whose statements a summary keeps before any other. */
export function heldForKihan(whole: Record<string, unknown>, on: string | null, holds = GRAPH_SUMMARY_STATEMENTS): Record<string, unknown> {
	const stated = (whole.quads ?? []) as TStated[];
	if (stated.length <= holds) return whole;
	const isAbout = (q: TStated) => on !== null && (q.subject === on || q.object === on);
	const held = [...stated.filter(isAbout), ...stated.filter((q) => !isAbout(q))].slice(0, holds);
	return {
		...whole,
		quads: held,
		statementsHeld: held.length,
		readTheRestWith: linkTo(stepMethodName(GRAPH_SOURCE_STEPPER, GET_CLUSTERED_QUADS), { perTypeLimit: stated.length }, "every statement this graph draws"),
	};
}
