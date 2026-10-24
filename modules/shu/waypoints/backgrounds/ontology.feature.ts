import type { TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";

/** The heads of shu's waypoints over the ontology, which a feature states and each waypoint below declares. */
export const ontology = {
	of: (term: string) => `show the ontology of ${term}`,
};

export const backgrounds: TKirejiExport = {
	Ontology: [
		"The ontology the declarations state, as the class browser draws it, narrowed to the terms that hold a text.",
		"Activity: Read the ontology narrowed to a term",
		"matching {term}, show ontology",
		`waypoint ${ontology.of("{term}")}`,
	],
};
