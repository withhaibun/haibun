/**
 * The views the domains declare, as the views picker lists them: each domain that names the component drawing it.
 */
import type { TDomainDiscoveryInfo } from "@haibun/core/lib/step-discovery.js";

/** A view a reader opens: the type or domain it shows, what it shows, and the component that draws it. */
export type TDeclaredView = { id: string; description: string; component: string };

/** Returns the views among `domains`, apart from the component `listing` that lists them. A view of a persisted type is named
 *  by the type, and any other by its domain's key; a view is described by its domain, or by its key where the domain doesn't
 *  describe itself. */
export function declaredViews(domains: Record<string, TDomainDiscoveryInfo>, listing: string): TDeclaredView[] {
	return Object.entries(domains).flatMap(([key, { ui, persistedAs, description }]) => {
		const component = ui?.component;
		if (typeof component !== "string" || component === listing) return [];
		const id = persistedAs === undefined ? key : persistedAs;
		return [{ id, description: description === undefined ? id : description, component }];
	});
}
