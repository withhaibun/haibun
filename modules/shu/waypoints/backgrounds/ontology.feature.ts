import type { TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";

/** The heads of shu's waypoints over the ontology, which a feature states and each waypoint below declares. */
export const ontology = {
	of: (term: string) => `read the ontology's classes matching ${term}`,
};

export const backgrounds: TKirejiExport = {
	Ontology: [
		"The ontology the declarations state, as the class browser draws it: the Class records, narrowed to the classes that hold a text.",
		"Activity: Read the ontology's classes narrowed to a term",
		'matching {term}, graph query {"label":"Class"}',
		`waypoint ${ontology.of("{term}")}`,
	],
};
