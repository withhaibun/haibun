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
/** A domain goal as ensure states it: a registered domain's key, whose fact ensure makes hold by the goal's plan. */
export const DOMAIN_DOMAIN_GOAL = "domain-goal";

const VerdictSchema = z.enum(VERDICT);

/** A binding a proof passes to an effect, innermost first: a quantifier's member, a waypoint's arguments, which a waypoint's
 *  session passes to its lines, or the context a node opens. */
const BindingSchema = z.union([
	z.object({ node: z.string(), member: z.string() }),
	z.object({ node: z.string(), args: z.array(z.object({ name: z.string(), value: z.string() })) }),
	z.object({ node: z.string(), within: z.array(z.number()) }),
]);
export type TBinding = z.infer<typeof BindingSchema>;
/** A waypoint's arguments as a binding of its node. */
export type TArgsBinding = Extract<TBinding, { args: unknown }>;

/** The effects a proof requests, by kind. */
export const EFFECT = { call: "call", open: "open", close: "close", members: "members", waypoint: "waypoint", wait: "wait" } as const;
/** The remedy where a proof reaches a request or a result the TypeScript prover doesn't hold, which a step program from another
 *  build of haibun makes. */
export const DIFFERENT_BUILDS = "The step program and the TypeScript prover are from different builds; run `npm run build` in haibun.";

/** A fact a read returns: its subject, predicate, object and named graph. */
export type TFact = Pick<TQuad, "subject" | "predicate" | "object" | "namedGraph">;
/** The positions of a fact, in the order a read's key states them. */
export const FACT_POSITIONS = ["subject", "predicate", "object", "namedGraph"] as const;

const NodeRequestSchema = z.object({ node: z.string(), bindings: z.array(BindingSchema) });
/** A node's close: its verdict and what determined it, the position of a part or the reason the engine states. */
const CloseRequestSchema = z.object({ node: z.string(), verdict: VerdictSchema, why: z.union([z.array(z.number()), z.string()]) });

/** How a proof reads a waypoint's head: in a proof, a goal of the reasoner; in ensure, P ∨ (¬P ∧ [A]P); and in a line run
 *  alone, P ∨ [A]. */
export const APPLY_MODE = { prove: "prove", ensure: "ensure", run: "run" } as const;
/** A waypoint effect: how it reads the head a node applies, and the node's bindings. */
const WaypointEffectSchema = z.object({ mode: z.enum(APPLY_MODE), node: z.string(), bindings: z.array(BindingSchema) });
export type TWaypointEffect = z.infer<typeof WaypointEffectSchema>;
export type TNodeRequest = z.infer<typeof NodeRequestSchema>;
export type TCloseRequest = z.infer<typeof CloseRequestSchema>;

/** A node of a goal's proof over producer rules: the domain a fact holds of, a producer whose inputs are its nodes, a composite's
 *  fields, or an argument a caller supplies. */
export type TProofNode =
	| { fact: string }
	| { argument: string }
	| { do: string; domain: string; inputs: TProofNode[] }
	| { composite: string; fields: { name: string; domain: string; type: string; optional: boolean; proof: TProofNode }[] };
/** A goal's proof: whether a fact of its domain holds, a proof for each producer whose inputs hold, and, where it doesn't have
 *  either, the chain of sub-goals down to the first it couldn't prove. */
export type TGoalProof = { goal: string; held: boolean; plans: TProofNode[]; unmet: ({ domain: string; do: string } | { unmet: string; why: string })[] };

/** The state of a proof after one query: a line's verdict where the proof ended, or the effect it needs. */
export const ProofStateSchema = z.union([
	z.object({ verdict: VerdictSchema }),
	z.object({
		need: z.string(),
		path: z.array(z.number()),
		// A waypoint effect holds a node and its bindings as a node's request does, so it is read first.
		request: z.union([WaypointEffectSchema, NodeRequestSchema, CloseRequestSchema, z.object({ node: z.string(), attempt: z.number() })]),
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
