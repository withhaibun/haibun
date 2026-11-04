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
		"Essential, for containment checks. A step that is part of a step is a step, by the intersection alone; a step isn't entailed a principal, and a standard doesn't state an activity and an agent disjoint, so that claim is unknown and fails closed. Source: members.ts, subsumes.",
		"every SeqPath and isPartOf some SeqPath is a SeqPath",
		"set principals from maybe every SeqPath is a Principal",
		'variable principals.verdict is "unknown"',
		"The refusal holds its witness as data: the subsumption that doesn't hold, and the steps the principals don't hold.",
		'variable principals.witness.subsumption is "SeqPath ⊑ Principal"',
		'variable principals.witness.members.0.persistedAs is "SeqPath"',
		"Its refusal states the subsumption check, the entailment, the verdict and why: K doesn't entail the axiom and doesn't contradict it.",
		`matches principals.refusal with "subsumption check · K ⊨ SubClassOf(SeqPath Principal) · unknown · K doesn't entail the axiom and doesn't contradict it*"`,

		scenario({ scenario: "A claim K contradicts is refuted, with the axioms of its contradiction" }),
		"Essential, for the formal model. A step is a PROV activity and a comment a PROV entity, which PROV-O states disjoint, so the reasoner entails that a step isn't a comment by the rule cax-dw of OWL 2 RL. The refusal names the standard's axiom, the superclasses the types declare and the record's type, as its record's entailment does in its why. Source: claims.ts, members.ts, disjointnessMet, rules/standard-axioms.n3.",
		'set steps from individuals of "SeqPath"',
		"set comment from maybe individual steps.members.0 is a Comment",
		'variable comment.verdict is "refuted"',
		`matches comment.refusal with "instance check · K ⊨ ClassAssertion(Comment <SeqPath:*>) · refuted · *ClassAssertion(SeqPath <SeqPath:*>), DisjointClasses(prov:Activity prov:Entity) (PROV-O W3C Recommendation 2013-04-30), SubClassOf(Comment prov:Entity), SubClassOf(SeqPath prov:Activity)"`,
		"A subsumption a member of the narrower expression refutes holds that member as its witness.",
		"set comments from maybe every SeqPath is a Comment",
		'variable comments.verdict is "refuted"',
		'variable comments.witness.members.0.persistedAs is "SeqPath"',
		`matches comments.refusal with "subsumption check · K ⊨ SubClassOf(SeqPath Comment) · refuted · *DisjointClasses(prov:Activity prov:Entity) (PROV-O W3C Recommendation 2013-04-30)*, and the witness that exceeds it is SeqPath:*"`,

		scenario({ scenario: "A type's declaration states a disjointness a standard vocabulary doesn't, which refutes a claim and is cited as that declaration's" }),
		"Essential, for the formal model. A type a feature declares names the types it doesn't share a record with; the OWL export writes it as owl:disjointWith, annotated with the feature that declared it, so a refused claim's witness cites the declaration rather than a vocabulary. Source: variables-stepper.ts, owl.ts, members.ts.",
		"set of Ticket by id, with name, disjoint with SeqPath, stored at private",
		'set steps from individuals of "SeqPath"',
		"set ticket from maybe individual steps.members.0 is a Ticket",
		'variable ticket.verdict is "refuted"',
		'variable ticket.witness.statedBy is "declared in ./features/16-class-expressions.feature.ts"',
		`matches ticket.refusal with "*DisjointClasses(Ticket SeqPath) (declared in ./features/16-class-expressions.feature.ts)*"`,
		"A declaration that names a type that isn't declared is refused, naming the type and the types it may name.",
		"set refused from maybe set of Booking by id, with name, disjoint with Nonesuch, stored at private",
		`matches refused.refusal with "*disjoint with Nonesuch, which isn't a declared type. Declare the type first*"`,

		scenario({ scenario: "An existence holds where the records entail a member" }),
		"Essential, for the open world. Source: logic-stepper.ts, someOf.",
		"some SeqPath",

		scenario({ scenario: "A class expression reads in DL notation and in plain English as its line resolves" }),
		"Essential, for leading a reader to the formal model. Validating a line returns the reading of each value whose domain states one, which a reader checks beside the line. Source: class-expression.ts, dlOf and readingOf.",
		`set read from ${validated("individuals of SeqPath and isPartOf some SeqPath")}`,
		'variable read.valid is "true"',
		'variable read.readings.expression is "SeqPath ⊓ ∃isPartOf.SeqPath · a SeqPath and something that isPartOf a SeqPath"',

		scenario({ scenario: "A claim reads as the entailment it checks, and its result states it" }),
		"Essential, for the formal model. A claim holds exactly where its axiom is entailed, K ⊨ axiom, and is unknown where K doesn't entail the axiom and doesn't contradict it. Validating a claim's line returns its reasoning task, its axiom in OWL 2 functional and Manchester syntax and the entailment in DL notation, and the claim's result states the task, the entailment, the verdict and the proof or witness. Source: claim.ts, entailmentOf.",
		`set instance from ${validated("individual SeqPath:s1 is a SeqPath")}`,
		'variable instance.entailment.task is "instance check"',
		'variable instance.entailment.functional is "ClassAssertion(SeqPath SeqPath:s1)"',
		'variable instance.entailment.manchester is "Individual: SeqPath:s1 Types: SeqPath"',
		'variable instance.entailment.dl is "K ⊨ SeqPath:s1 ∈ SeqPath"',
		`set subsumption from ${validated("every SeqPath and isPartOf some SeqPath is a SeqPath")}`,
		'variable subsumption.entailment.task is "subsumption check"',
		'variable subsumption.entailment.functional is "SubClassOf(ObjectIntersectionOf(SeqPath ObjectSomeValuesFrom(isPartOf SeqPath)) SeqPath)"',
		'variable subsumption.entailment.dl is "K ⊨ SeqPath ⊓ ∃isPartOf.SeqPath ⊑ SeqPath"',
		`set retrieval from ${validated("some SeqPath")}`,
		'variable retrieval.entailment.task is "instance retrieval"',
		'variable retrieval.entailment.dl is "∃a. K ⊨ a ∈ SeqPath"',
		"The claim's result states its entailment and verdict, with its witness, as the subsumption's refusal above states its own:",
		"set existence from some SeqPath",
		'variable existence.claim.entails is "∃a. K ⊨ ClassAssertion(SeqPath a)"',
		'variable existence.claim.verdict is "proved"',
		'matches existence.claim.proof with "the witness is SeqPath:*"',

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
