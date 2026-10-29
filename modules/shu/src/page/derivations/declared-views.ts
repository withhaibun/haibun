/**
 * The views the domains declare, as the views picker lists them: each view the catalog declares, with the component that draws
 * it and what its domain holds.
 */
import type { TDomainDiscoveryInfo } from "@haibun/core/lib/step-discovery.js";

/** A view a reader opens: the domain it shows, what it shows, and the component that draws it. */
export type TDeclaredView = { id: string; description: string; component: string };

/** Returns the views `views` names, each drawn by the component `componentOf` returns and described by its domain in `domains`,
 *  apart from the component `listing` that lists them. Throws for a view whose domain actuality doesn't declare. */
export function declaredViews(views: readonly string[], componentOf: (view: string) => string, domains: Record<string, TDomainDiscoveryInfo>, listing: string): TDeclaredView[] {
	return views.flatMap((id) => {
		const component = componentOf(id);
		if (component === listing) return [];
		const description = domains[id]?.description;
		if (description === undefined) throw new Error(`the catalog declares the view ${id}, whose domain actuality doesn't declare`);
		return [{ id, description, component }];
	});
}
