/** A text a step reads of the page, kept in a variable with the step's provenance. */
import type { TFeatureStep } from "@haibun/core/lib/astepper.js";
import { DOMAIN_STRING } from "@haibun/core/lib/domains.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import { OK, Origin, type TActionResult } from "@haibun/core/schema/protocol.js";
import { provenanceOf } from "../derivations/provenance.js";

/** Keeps `value` in the variable `where`; a value the page lacks, such as an absent query parameter, is kept as null. */
export async function keepText(world: TWorld, where: string, value: string | null, featureStep: TFeatureStep): Promise<TActionResult> {
	await world.shared.set({ term: where, value, domain: DOMAIN_STRING, origin: Origin.var }, provenanceOf(featureStep));
	return OK;
}
