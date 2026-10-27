import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";

const { feature, scenario } = withAction(new Haibun());

/** The validation of a line that names a class expression. */
const validated = (line: string) => `validate step "${line}"`;

export const features: TKirejiExport = {
	"Class expressions": [
		feature({ feature: "Class expressions" }),
		`A claim states what holds, and the reasoner proves it over the ontology and the records, open world: a membership, a subsumption and an existence. A claim the records don't prove is unknown, which isn't false, so the claim fails closed. A class expression is Manchester syntax in the fragment OWL 2 RL evaluates for a query, and the reasoner returns the records it entails, open world. A line resolves only where its expression is in that fragment and names the ontology's classes and properties in their direction. Each refusal names the construct or the name, the reason and the form to write (docs/open-world/plan.md, Language).`,

		scenario({ scenario: "A record is a member of its type's class" }),
		"Essential, for the formal model. A step's record is an individual of the class SeqPath. Source: members.ts.",
		'set steps from individuals of "SeqPath"',
		"individual steps.members.0 is a SeqPath",

		scenario({ scenario: "A subsumption holds where the ontology entails it" }),
		"Essential, for containment checks. A step that is part of a step is a step, by the intersection alone; a step isn't entailed a comment, so that claim fails closed. Source: members.ts, subsumes.",
		"every SeqPath and isPartOf some SeqPath is a SeqPath",
		"not every SeqPath is a Comment",

		scenario({ scenario: "An existence holds where the records entail a member" }),
		"Essential, for the open world. Source: logic-stepper.ts, someOf.",
		"some SeqPath",

		scenario({ scenario: "A class expression reads in DL notation and in plain English as its line resolves" }),
		"Essential, for leading a reader to the formal model. Validating a line returns the reading of each value whose domain states one, which a reader checks beside the line. Source: class-expression.ts, dlOf and readingOf.",
		`set read from ${validated("individuals of SeqPath and isPartOf some SeqPath")}`,
		'variable read.valid is "true"',
		'variable read.readings.expression is "SeqPath ⊓ ∃isPartOf.SeqPath · a SeqPath and something that isPartOf a SeqPath"',

		scenario({ scenario: "An expression over an inverse property returns the records another record reaches" }),
		"Essential, for the open world. A step a later step is part of is reached through the inverse of the relation. Source: members.ts.",
		'set parents from counting individuals of "inverse isPartOf some SeqPath"',
		'variable parents.total is more than "0"',

		scenario({ scenario: "A class expression outside the fragment, or with a name the ontology doesn't hold, is refused as the line resolves" }),
		"Essential, for leading a reader to the formal model. Source: class-expression.ts.",
		`set universal from ${validated("individuals of isPartOf only SeqPath")}`,
		'variable universal.valid is "false"',
		'matches universal.error with "*uses `only`*State the positive check*"',
		`set misspelled from ${validated("individuals of SeqPth")}`,
		'variable misspelled.valid is "false"',
		'matches misspelled.error with "*Did you mean SeqPath?*"',
		"A name a reader is still typing is completed by the instance, which offers each name of the ontology that begins with it:",
		`set partial from ${validated("individuals of SeqPat")}`,
		'variable partial.completions.0 is "SeqPath"',
	],
};
