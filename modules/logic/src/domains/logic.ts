/**
 * The logic engine's declarations: what a query of a line's proof returns, the effects a proof requests, and the
 * derivation a proof writes as records.
 */
import { z } from "zod";
import { VERDICT } from "@haibun/core/lib/domains/protocol.js";
import type { TDomainDefinition } from "@haibun/core/lib/domains/resources.js";
import { DOMAIN_DOMAIN_KEY } from "@haibun/core/lib/domains/domains.js";

/** The statement of a goal, which the resolve step's pattern parses and a goal's proof and conjecture render. */
export const RESOLVE_STATEMENT = `resolve {goal: ${DOMAIN_DOMAIN_KEY}}`;

const VerdictSchema = z.enum(VERDICT);

/** A binding a proof passes to an effect, innermost first: a quantifier's member, a waypoint's arguments, or the context a
 *  node opens. */
const BindingSchema = z.union([
	z.object({ node: z.string(), member: z.string() }),
	z.object({ node: z.string(), args: z.array(z.object({ name: z.string(), value: z.string() })) }),
	z.object({ node: z.string(), within: z.array(z.number()) }),
]);
export type TBinding = z.infer<typeof BindingSchema>;

/** The effects a proof requests, by kind. */
export const EFFECT = { call: "call", open: "open", close: "close", members: "members", args: "args", rule: "rule", wait: "wait" } as const;

const NodeRequestSchema = z.object({ node: z.string(), bindings: z.array(BindingSchema) });
const CloseRequestSchema = z.object({ node: z.string(), verdict: VerdictSchema, why: z.union([z.array(z.number()), z.string()]) });

/** The state of a line's proof after one query: its verdict where the proof ended, or the effect it needs. */
export const ProofStateSchema = z.union([
	z.object({ verdict: VerdictSchema }),
	z.object({
		need: z.string(),
		path: z.array(z.number()),
		request: z.union([NodeRequestSchema, CloseRequestSchema, z.object({ rule: z.string() }), z.object({ node: z.string(), attempt: z.number() })]),
	}),
]);
export type TProofState = z.infer<typeof ProofStateSchema>;
export type TNodeRequest = z.infer<typeof NodeRequestSchema>;
export type TCloseRequest = z.infer<typeof CloseRequestSchema>;

/** A node of a goal's proof over producer rules: a fact of its domain, a producer whose inputs are its nodes, a composite's
 *  fields, an argument a caller supplies, or the sub-goal it couldn't prove with the reason. */
export type TProofNode =
	| { fact: string; domain: string }
	| { argument: string }
	| { do: string; domain: string; inputs: TProofNode[] }
	| { composite: string; fields: { name: string; domain: string; type: string; optional: boolean; proof: TProofNode }[] }
	| { unmet: string; why: string };
const ProofNodeSchema: z.ZodType<TProofNode> = z.union([
	z.object({ fact: z.string(), domain: z.string() }),
	z.object({ argument: z.string() }),
	z.object({ do: z.string(), domain: z.string(), inputs: z.array(z.lazy(() => ProofNodeSchema)) }),
	z.object({
		composite: z.string(),
		fields: z.array(z.object({ name: z.string(), domain: z.string(), type: z.string(), optional: z.stringbool(), proof: z.lazy(() => ProofNodeSchema) })),
	}),
	z.object({ unmet: z.string(), why: z.string() }),
]);

/** A goal's proof: the facts of its domain, a proof for each producer whose inputs hold, and, where it doesn't have either, the
 *  chain of sub-goals down to the first it couldn't prove. */
export const GoalProofSchema = z.object({
	goal: z.string(),
	held: z.stringbool(),
	plans: z.array(ProofNodeSchema),
	unmet: z.array(z.union([z.object({ domain: z.string(), do: z.string() }), z.object({ unmet: z.string(), why: z.string() })])),
});
export type TGoalProof = z.infer<typeof GoalProofSchema>;

/** The outcome of a built-in call, as the engine reads it. */
export const CALL_OUTCOME = { passed: "passed", failed: "failed", refused: "refused" } as const;

/** The record of a call in a derivation: its position, its line, what it called, its verdict and the actions that allowed it. */
const DerivationCallSchema = z.object({
	path: z.string(),
	stepText: z.string(),
	called: z.string().optional(),
	verdict: VerdictSchema.optional(),
	allowedAction: z.string().optional(),
	capabilityAction: z.string().optional(),
	error: z.string().optional(),
});

/** A statement's derivation: its verdict, the records its proof wrote under the step that requested it, the calls among
 *  them, and the line of the first goal it couldn't prove with the reason its record states, where its proof failed. */
export const DerivationSchema = z.object({
	verdict: VerdictSchema,
	records: z.array(z.looseObject({ id: z.string(), isPartOf: z.string().optional() })),
	calls: z.array(DerivationCallSchema),
	firstUnmet: z.string().optional(),
	reason: z.string().optional(),
});
export type TDerivation = z.infer<typeof DerivationSchema>;

/** A rule a formula states: the formula's name, its role, and its rendering in Unicode notation. */
export const RuleSchema = z.object({ name: z.string(), role: z.string(), rendered: z.string() });
export type TRule = z.infer<typeof RuleSchema>;

export const DOMAIN_DERIVATION = "derivation";
export const DOMAIN_FORMULA = "formula";
export const DOMAIN_RULE = "rule";
export const DOMAIN_LINE_TERM = "line-term";
/** The domain of a projection of formulas, which the stepper whose step returns one declares. */
export const DOMAIN_FORMULA_PROJECTION = "formula-projection";

/** A TPTP FOF formula a line writes. The logic stepper adds the resolver's check: the formula parses, it is in the engine's
 *  fragment, and each predicate it names is an entry of the registry. */
export const formulaDomainDefinition: TDomainDefinition = {
	selectors: [DOMAIN_FORMULA],
	schema: z.string().min(1),
	written: true,
	description: "One annotated TPTP FOF formula in the engine's fragment, whose predicates are entries of the registry",
};

/** What a token of a formula's Unicode rendering is: a predicate, a constant or a function, a variable, or a symbol. */
export const TOKEN_ROLE = { predicate: "predicate", constant: "constant", variable: "variable", symbol: "symbol" } as const;
export type TTokenRole = (typeof TOKEN_ROLE)[keyof typeof TOKEN_ROLE];

/** The record a formula's statement names: its type and its id. */
const AssertedBySchema = z.object({ persistedAs: z.string(), id: z.string() }).strict();
export type TAssertedBy = z.infer<typeof AssertedBySchema>;

/**
 * Formulas projected for every surface that reads them: their ASCII TPTP text, a summary of their kinds, each formula's Unicode
 * tokens with its statement and asserting record, and their term graph, whose nodes and edges each name the formulas that state
 * them, with the clusters the projection badges.
 */
export const ProjectionSchema = z
	.object({
		text: z.string(),
		summary: z.object({ axioms: z.number().int(), rules: z.number().int(), conjectures: z.number().int() }).strict(),
		formulas: z.array(
			z
				.object({
					name: z.string(),
					role: z.string(),
					statement: z.string(),
					assertedBy: AssertedBySchema.optional(),
					tptp: z.string(),
					tokens: z.array(z.object({ text: z.string(), role: z.enum(TOKEN_ROLE), node: z.string().optional() }).strict()),
				})
				.strict(),
		),
		nodes: z.array(
			z.object({ id: z.string(), label: z.string(), kind: z.string(), classes: z.array(z.string()), formulas: z.array(z.string()), hollow: z.literal(true).optional() }).strict(),
		),
		edges: z.array(z.object({ from: z.string(), to: z.string(), label: z.string(), formula: z.string() }).strict()),
		clusters: z.array(z.object({ kind: z.string(), badge: z.string() }).strict()),
	})
	.strict();
export type TProjection = z.infer<typeof ProjectionSchema>;

/** A line and the term it parses to, with the line the term renders as. */
export const LineTermSchema = z.object({ line: z.string(), term: z.string(), rendered: z.string() });

export const logicDomainDefinitions: TDomainDefinition[] = [
	{
		selectors: [DOMAIN_DERIVATION],
		schema: DerivationSchema,
		description: "A statement's verdict, the records its proof wrote, its calls, and the first goal it couldn't prove with its reason",
	},
	{ selectors: [DOMAIN_LINE_TERM], schema: LineTermSchema, description: "A line, the term the registry parses it to, and the line the term renders as" },
	{ selectors: [DOMAIN_RULE], schema: RuleSchema, description: "A rule a formula states: its name, its role and its rendering in Unicode notation" },
];

/** The namespace of the IRIs a proof's N3 export names. */
export const PROOF_NAMESPACE = "urn:haibun:proof#";
