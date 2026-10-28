/**
 * The catalog of the step registry the page holds, derived once per read (`derivations/catalog.ts`). A read before the page
 * reads actuality's steps throws and names what read it.
 */
import type { Machine } from "@haibun/core/lib/machines/machine.js";
import { REGISTRY_STATUS, type TRegistryEvent, type TRegistryState, type TStepList } from "../machines/registry.js";
import { catalogOf, type TCatalog } from "../derivations/catalog.js";

/** Returns the steps `registry` holds. Throws before the page reads actuality's steps, and names what `what` read. */
export function heldSteps(registry: Machine<TRegistryState, TRegistryEvent>, what: string): TStepList {
	const state = registry.state.get();
	if (state.status !== REGISTRY_STATUS.READ) throw new Error(`${what} is read after actuality's steps: call getAvailableSteps() first`);
	return state.read.list;
}

/** Returns the catalog `registry` holds. Throws before the page reads actuality's steps, and names what `what` read. */
export const heldCatalog = (registry: Machine<TRegistryState, TRegistryEvent>, what: string): TCatalog => catalogOf(heldSteps(registry, what));

/** Whether `registry` holds a catalog, which a page that carries a record without the site's registry doesn't. */
export const holdsCatalog = (registry: Machine<TRegistryState, TRegistryEvent>): boolean => registry.state.get().status === REGISTRY_STATUS.READ;
