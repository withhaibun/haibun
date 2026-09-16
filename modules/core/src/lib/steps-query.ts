/**
 * The one way any caller reads what a run declares: its steps, its domains and its types, matched by a pattern.
 *
 * A page, a remote host, an MCP host, a model and a feature line all call the same step with the same query. Separate
 * from step-registry because the browser reads this module, and step-registry builds schemas on the server.
 */
import { z } from "zod";

/** The step that shows what a run declares. `Haibun` declares it, so a run that serves callers lists `haibun`. */
export const SHOW_STEPS_METHOD = "Haibun-showSteps";

/** The most declarations of each kind one read returns. */
export const MOST_SHOWN = 10_000;

/** The longest pattern a read takes, which bounds the work a caller's pattern makes. */
export const MOST_PATTERN_CHARS = 200;

const compiles = (pattern: string): boolean => {
	try {
		new RegExp(pattern, "i");
		return true;
	} catch {
		return false;
	}
};

/** A read of what a run declares: a case-insensitive regular expression, and the most of each kind to return. */
export const StepsQuerySchema = z.object({
	pattern: z.string().max(MOST_PATTERN_CHARS).refine(compiles, "the pattern is not a regular expression"),
	limit: z.number().int().min(1).max(MOST_SHOWN),
});
export type TStepsQuery = z.infer<typeof StepsQuerySchema>;

/** Every declaration a run holds, which is what a page and a remote host read. */
export const EVERY_DECLARATION: TStepsQuery = { pattern: ".*", limit: MOST_SHOWN };

/** How many declarations of each kind a pattern matched. Where one exceeds the limit, the read returned the first of them. */
export const ShownTotalSchema = z.object({ steps: z.number(), domains: z.number(), persisted: z.number(), references: z.number() }).strict();
export type TShownTotal = z.infer<typeof ShownTotalSchema>;

/** Whether a read returned every declaration its pattern matched. A caller that needs all of them fails where it did not. */
export function shownWhole(total: TShownTotal, query: TStepsQuery): boolean {
	return Object.values(total).every((matched) => matched <= query.limit);
}
