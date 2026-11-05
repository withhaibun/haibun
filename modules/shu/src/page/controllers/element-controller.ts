/**
 * The page's element registry, as a view defines its own element (CA4D18) and mounts a component a concern declares.
 */
import { pageElements, pageLog, pageRegistry, pageViewLoader } from "../root.js";
import { loadDeclaredComponent } from "../pipelines/declared-component.js";
import { heldCatalog } from "../pipelines/held-catalog.js";

/** Defines `element` under `tag`, where the page doesn't define the tag yet. A page loads a view's module in more than one
 *  of its bundles, and the first definition holds. */
/** A load made at its first use: a view loads an element it rarely shows where it first shows it. */
export { loadedOnFirstUse } from "../root.js";

export const defineElement = (tag: string, element: CustomElementConstructor): void => pageElements().define(tag, element);

/** Whether the page defines `tag`. */
export const isDefined = (tag: string): boolean => pageElements().isDefined(tag);

/** Loads the component `tag` that a concern declares (`loadDeclaredComponent`). */
export const loadComponent = async (tag: string): Promise<void> => {
	// A view of the page's own loads where a pane first shows it; a component a concern declares loads its script.
	const loader = pageViewLoader(tag);
	if (loader === undefined) return loadDeclaredComponent(pageElements(), () => heldCatalog(pageRegistry(), `the component ${tag}`), tag, pageLog);
	await loader();
};
