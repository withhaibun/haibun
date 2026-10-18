/**
 * Writes and reads facts: the products of steps, held in working memory. A fact's id is the record name of the step that
 * produced it, followed by the product's field where the step declares a domain for each field. So a step that runs again
 * replaces its fact. Each fact links its step's record through `prov:wasGeneratedBy`.
 */
import { EDGE, FACT_LABEL, SEQ_PATH_LABEL } from "../../domains/resources.js";
import { GraphQuerySchema } from "../../steps/domains/quad-types.js";
import { type IQuadStore } from "../../steps/ports.js";
import { factIdOf, formatRecordName, type TRecordName } from "../../actuality/domains/seq-path.js";
import { FACT_FIELD, type TFact } from "../domains/facts.js";
import { equalTo, readEvery, type TRecordReader } from "./record-reads.js";

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

const factOf = (record: Record<string, unknown>): TFact => ({ id: String(record[FACT_FIELD.id]), domain: String(record[FACT_FIELD.domain]), value: record[FACT_FIELD.value] });

/** Reads every fact working memory holds, or the facts of one domain. */
export async function readFacts(store: TRecordReader, domain?: string): Promise<TFact[]> {
	const filters = domain === undefined ? [] : equalTo({ [FACT_FIELD.domain]: domain });
	return (await readEvery(store, { label: FACT_LABEL, filters })).map(factOf);
}

/** Returns true where working memory holds a fact of a domain. */
export async function holdsFactOf(store: TRecordReader, domain: string): Promise<boolean> {
	const page = await store.readRecords(GraphQuerySchema.parse({ label: FACT_LABEL, filters: equalTo({ [FACT_FIELD.domain]: domain }), limit: 1, skipCount: true }));
	return page.vertices.length > 0;
}
