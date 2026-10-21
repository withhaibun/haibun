/**
 * Writes facts: the products of steps, held in core's in-memory store. A fact's id is the record name of the step that
 * produced it, followed by the product's field where the step declares a domain for each field. So a step that runs again
 * replaces its fact. Each fact links its step's record through `prov:wasGeneratedBy`.
 */
import { EDGE, FACT_LABEL, SEQ_PATH_LABEL } from "../../domains/resources.js";
import { type IQuadStore } from "../../steps/ports.js";
import { factIdOf, formatRecordName, type TRecordName } from "../../actuality/domains/seq-path.js";
import { FACT_FIELD } from "../domains/facts.js";

/** One product of a step: its domain, its value, the field of the product where the step declares a domain for each field, and when it was produced. */
export type TProduct = { domain: string; value: unknown; field?: string; generatedAtTime: string };

/** Writes the fact of one product of a step, and the fact's edge to the step's record. Returns the fact's id. */
export async function assertFact(store: Pick<IQuadStore, "upsertIndividual" | "createEdge">, step: TRecordName, product: TProduct): Promise<string> {
	if (!store.createEdge) throw new Error(`the store doesn't write edges, so a fact can't link the step ${formatRecordName(step)} that produced it`);
	const id = factIdOf(step, product.field);
	await store.upsertIndividual(FACT_LABEL, {
		[FACT_FIELD.id]: id,
		[FACT_FIELD.domain]: product.domain,
		[FACT_FIELD.value]: product.value,
		[FACT_FIELD.generatedAtTime]: product.generatedAtTime,
	});
	await store.createEdge(FACT_LABEL, id, EDGE.wasGeneratedBy, SEQ_PATH_LABEL, formatRecordName(step));
	return id;
}
