/**
 * The write of a call's products, which dispatch makes for a step whose contract declares `written`, once the products pass the
 * contract's `states`. The products are one record of the stored type of their domain, written through the store's port with
 * the verb the contract names, so a call that the check refuses doesn't write them.
 */
import type { TWorld } from "../../actuality/domains/world.js";
import { normalizeDomainKey } from "../../domains/domains.js";
import { NODE_KEY } from "../../records/domains/unit.js";
import { contractProducts, type TStepContract } from "../domains/contract.js";

/** Writes `products` through the store's port where the step's contract declares `written`. Throws where the products domain
 *  isn't one stored type, since dispatch writes the products as one record of it. */
export async function writeProducts(world: TWorld, step: { readonly contract?: TStepContract }, name: string, products: Readonly<Record<string, unknown>>): Promise<void> {
	const verb = step.contract?.written;
	if (verb === undefined) return;
	const { domain } = contractProducts(step);
	const persistedAs = domain === undefined ? undefined : world.domains[normalizeDomainKey(domain)]?.topology?.persistedAs;
	if (persistedAs === undefined)
		throw new Error(`${name} declares contract.written, and its products aren't one stored type: declare its products as a domain whose topology states persistedAs`);
	await world.shared.getStore()[verb]({ ...products, [NODE_KEY.type]: persistedAs });
}
