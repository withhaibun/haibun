/**
 * The write of a call's products, which dispatch makes for a step whose contract declares `written`, once the products pass the
 * contract's `states`. The products are one record of the stored type of their domain, written through the store's port with
 * the verb the contract names, so a call that the check refuses doesn't write them.
 */
import { z } from "zod";
import type { TWorld } from "../../actuality/domains/world.js";
import { normalizeDomainKey } from "../../domains/domains.js";
import { NODE_KEY } from "../../records/domains/unit.js";
import { createOrKeep, readVersioned } from "../../records/pipelines/record-versions.js";
import { contractProducts, KEEP_VERB, type TStepContract } from "../domains/contract.js";

/** A held record as `keep` compares it: its fields by their keys. */
const FieldsSchema = z.record(z.string(), z.unknown());

/** Writes `products` through the store's port where the step's contract declares `written`. Throws where the products domain
 *  isn't one stored type, since dispatch writes the products as one record of it, and where `keep` finds the record held with
 *  other values of the products' fields. */
export async function writeProducts(world: TWorld, step: { readonly contract?: TStepContract }, name: string, products: Readonly<Record<string, unknown>>): Promise<void> {
	const verb = step.contract?.written;
	if (verb === undefined) return;
	const { domain } = contractProducts(step);
	const definition = domain === undefined ? undefined : world.domains[normalizeDomainKey(domain)];
	const topology = definition?.topology;
	if (definition === undefined || topology?.persistedAs === undefined)
		throw new Error(`${name} declares contract.written, and its products aren't one stored type: declare its products as a domain whose topology states persistedAs`);
	const store = world.shared.getStore();
	const node = { ...products, [NODE_KEY.type]: topology.persistedAs };
	if (verb !== KEEP_VERB) {
		await store[verb](node);
		return;
	}
	const type = { label: topology.persistedAs, schema: definition.schema };
	const read = async () => {
		const { record, version } = await readVersioned(store, type, String(products[topology.id]));
		return { version, record: record === undefined ? undefined : FieldsSchema.parse(record) };
	};
	await createOrKeep(read, (written, version) => store.update(written, version), node);
}
