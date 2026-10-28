/**
 * The logic engine's declarations: what a query of a line's proof returns, the effects a proof requests, and the
 * derivation a proof writes as records.
 */
import { z } from "zod";
import { VERDICT } from "@haibun/core/lib/domains/protocol.js";
import type { TDomainDefinition } from "@haibun/core/lib/domains/resources.js";
import { DOMAIN_DOMAIN_KEY } from "@haibun/core/lib/domains/domains.js";
import type { TQuad } from "@haibun/core/lib/steps/domains/quad-types.js";

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
export const EFFECT = { call: "call", open: "open", close: "close", read: "read", rule: "rule", wait: "wait" } as const;
/** The remedy where a proof reaches a request or a result the TypeScript prover doesn't hold, which a step program from another
 *  build of haibun makes. */
export const DIFFERENT_BUILDS = "The step program and the TypeScript prover are from different builds; run `npm run build` in haibun.";

/** A fact a read returns: its subject, predicate, object and named graph. */
export type TFact = Pick<TQuad, "subject" | "predicate" | "object" | "namedGraph">;
/** The positions of a fact, in the order a pattern's variables take their values. */
export const FACT_POSITIONS = ["subject", "predicate", "object", "namedGraph"] as const;
/** A read's pattern: the constants of its subject, predicate, object and named graph. A position it doesn't state is its variable. */
const PatternSchema = z.object({ subject: z.string(), predicate: z.string(), object: z.string(), namedGraph: z.string() }).partial();
/** The named graphs a proof reads beside the store's types, and their predicates: a node's own facts, a quantifier's members
 *  and a waypoint's arguments by their names; the falsities `absent` states, each a record's goal head and arguments; and
 *  the individuals `is the same as` states equal. */
export const READ_GRAPH = { node: "node", falsity: "falsity", same: "same" } as const;
export const READ_PREDICATE = { member: "member", head: "head", sameAs: "sameAs" } as const;

const NodeRequestSchema = z.object({ node: z.string(), bindings: z.array(BindingSchema) });
const ReadRequestSchema = z.object({ patterns: z.array(PatternSchema), bindings: z.array(BindingSchema) });
/** A node's close: its verdict and what determined it, the position of a part, the reason the engine states, or the record that stated its falsity. */
const CloseRequestSchema = z.object({ node: z.string(), verdict: VerdictSchema, why: z.union([z.array(z.number()), z.string(), z.object({ falsity: z.string() })]) });

export type TNodeRequest = z.infer<typeof NodeRequestSchema>;
export type TReadRequest = z.infer<typeof ReadRequestSchema>;
export type TCloseRequest = z.infer<typeof CloseRequestSchema>;

/** A node of a goal's proof over producer rules: the domain a fact holds of, a producer whose inputs are its nodes, a
 *  composite's fields, an argument a caller supplies, or the sub-goal it couldn't prove with the reason. */
export type TProofNode =
	| { fact: string }
	| { argument: string }
	| { do: string; domain: string; inputs: TProofNode[] }
	| { composite: string; fields: { name: string; domain: string; type: string; optional: boolean; proof: TProofNode }[] }
	| { unmet: string; why: string };
const ProofNodeSchema: z.ZodType<TProofNode> = z.union([
	z.object({ fact: z.string() }),
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

/** The state of a proof after one query: a line's verdict or the proofs of goals where the proof ended, or the effect it needs. */
export const ProofStateSchema = z.union([
	z.object({ verdict: VerdictSchema }),
	z.object({ goals: z.array(GoalProofSchema) }),
	z.object({
		need: z.string(),
		path: z.array(z.number()),
		request: z.union([NodeRequestSchema, ReadRequestSchema, CloseRequestSchema, z.object({ rule: z.string() }), z.object({ node: z.string(), attempt: z.number() })]),
	}),
]);
export type TProofState = z.infer<typeof ProofStateSchema>;

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
export const DOMAIN_DERIVATION = "derivation";
export const DOMAIN_LINE_TERM = "line-term";

/** A line and the term it parses to, with the line the term renders as. */
export const LineTermSchema = z.object({ line: z.string(), term: z.string(), rendered: z.string() });

export const logicDomainDefinitions: TDomainDefinition[] = [
	{
		selectors: [DOMAIN_DERIVATION],
		schema: DerivationSchema,
		description: "A statement's verdict, the records its proof wrote, its calls, and the first goal it couldn't prove with its reason",
	},
	{ selectors: [DOMAIN_LINE_TERM], schema: LineTermSchema, description: "A line, the term the registry parses it to, and the line the term renders as" },
];

/** The namespace of the IRIs a proof's N3 export names. */
export const PROOF_NAMESPACE = "urn:haibun:proof#";
