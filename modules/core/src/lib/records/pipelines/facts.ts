/**
 * Writes facts: the products of steps, held in core's in-memory store. A fact's id is the record name of the step that
 * produced it, followed by the product's field where the step declares a domain for each field. So a step that runs again
 * replaces its fact. Each fact links its step's record through `prov:wasGeneratedBy`.
 */
import { EDGE, FACT_LABEL, SEQ_PATH_LABEL } from "../../domains/resources.js";
import { type IQuadStore } from "../../steps/ports.js";
import { factIdOf, formatRecordName, type TRecordName } from "../../actuality/domains/seq-path.js";
import { FACT_FIELD } from "../domains/facts.js";
import { referenceTo } from "../domains/unit.js";

/** One product of a step: its domain, its value, and the field of the product where the step declares a domain for each field. */
export type TProduct = { domain: string; value: unknown; field?: string };

/** Writes the fact of one product of a step with its edge to the step's record, in one unit, and returns the fact's id. The fact
 *  is actuality's record of the step, and the store states when it was produced. */
export async function assertFact(store: Pick<IQuadStore, "merge">, step: TRecordName, product: TProduct): Promise<string> {
	const id = factIdOf(step, product.field);
	return await store.merge({
		"@type": FACT_LABEL,
		[FACT_FIELD.id]: id,
		[FACT_FIELD.domain]: product.domain,
		[FACT_FIELD.value]: product.value,
		[EDGE.wasGeneratedBy]: referenceTo(SEQ_PATH_LABEL, formatRecordName(step)),
	});
}
