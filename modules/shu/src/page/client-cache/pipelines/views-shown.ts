/**
 * The views a run has shown, as the elements they are shown in, in the order the site declares them.
 *
 * The set comes from the distinct values of the field a step names its view in, which is one value however many times a
 * view was shown: a view that refreshes its own data is shown by a step per refresh, and reading records to find the set
 * would read those instead of the views shown once each. A page arriving without an address of its own starts on these.
 */
import { SEQ_PATH_FIELD } from "@haibun/core/lib/seq-path.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/resources.js";

/** What finding the views shown reads: a type's select values by field, the views the site declares in its order, and the
 *  element that shows each. */
export type TViewsShownScope = { selectValues: (label: string) => Promise<Record<string, string[]>>; declared: () => string[]; componentOf: (view: string) => string };

/** Returns the elements of the views a run has shown, in the order the site declares the views. */
export async function viewsShown(scope: TViewsShownScope): Promise<string[]> {
	const values = await scope.selectValues(SEQ_PATH_LABEL);
	const listed = values[SEQ_PATH_FIELD.showed];
	const shown = new Set(listed === undefined ? [] : listed);
	return scope
		.declared()
		.filter((view) => shown.has(view))
		.map(scope.componentOf);
}
