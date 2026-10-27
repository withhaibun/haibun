import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";

const { feature, scenario } = withAction(new Haibun());

/** The validation of a line that names a class expression. */
const validated = (line: string) => `validate step "${line}"`;

export const features: TKirejiExport = {
	"Class expressions": [
		feature({ feature: "Class expressions" }),
		`A class expression is Manchester syntax in the fragment OWL 2 RL evaluates for a query, and the reasoner returns the records it entails, open world. A line resolves only where its expression is in that fragment and names the ontology's classes and properties in their direction. Each refusal names the construct or the name, the reason and the form to write (docs/open-world/plan.md, Language).`,

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
	],
};
