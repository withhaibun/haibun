/**
 * The logic engine's declarations: what a query of a line's proof returns, the effects a proof requests, a proof's parts,
 * and the derivation a proof writes as records.
 */
import { z } from "zod";
import { VERDICT, type TVerdict } from "@haibun/core/lib/domains/protocol.js";
import type { TDomainDefinition } from "@haibun/core/lib/domains/resources.js";

const VerdictSchema = z.enum(VERDICT);

/** A part of a proof: a call or a node at a position of the proof with its verdict, a group of parts, or a reason that
 *  determined a verdict without a part, such as an empty domain or the depth limit. */
export type TProofPart = { node: string; path: number[]; verdict: TVerdict; reading?: string; parts?: TProofPart[] } | { group: string; parts: TProofPart[] } | { reason: string };

const ProofPartSchema: z.ZodType<TProofPart> = z.lazy(() =>
	z.union([
		z.object({ node: z.string(), path: z.array(z.number()), verdict: VerdictSchema, reading: z.string().optional(), parts: z.array(ProofPartSchema).optional() }),
		z.object({ group: z.string(), parts: z.array(ProofPartSchema) }),
		z.object({ reason: z.string() }),
	]),
);

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

/** What one query of a line's proof returns: its verdict with its proof and the proof's term, or the effect it needs. */
export const AttemptSchema = z.union([
	z.object({ verdict: VerdictSchema, proof: ProofPartSchema, term: z.string() }),
	z.object({
		need: z.string(),
		path: z.array(z.number()),
		request: z.union([NodeRequestSchema, CloseRequestSchema, z.object({ rule: z.string() }), z.object({ node: z.string(), attempt: z.number() })]),
	}),
]);
export type TAttempt = z.infer<typeof AttemptSchema>;
export type TNodeRequest = z.infer<typeof NodeRequestSchema>;
export type TCloseRequest = z.infer<typeof CloseRequestSchema>;

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
 *  them, and the line of the first goal it couldn't prove, where its proof failed. */
export const DerivationSchema = z.object({
	verdict: VerdictSchema,
	records: z.array(z.looseObject({ id: z.string(), isPartOf: z.string().optional() })),
	calls: z.array(DerivationCallSchema),
	firstUnmet: z.string().optional(),
});
export type TDerivation = z.infer<typeof DerivationSchema>;

export const DOMAIN_DERIVATION = "derivation";
export const DOMAIN_LINE_TERM = "line-term";

/** A line and the term it parses to, with the line the term renders as. */
export const LineTermSchema = z.object({ line: z.string(), term: z.string(), rendered: z.string() });

export const logicDomainDefinitions: TDomainDefinition[] = [
	{ selectors: [DOMAIN_DERIVATION], schema: DerivationSchema, description: "A statement's verdict, the records its proof wrote, its calls and the first goal it couldn't prove" },
	{ selectors: [DOMAIN_LINE_TERM], schema: LineTermSchema, description: "A line, the term the registry parses it to, and the line the term renders as" },
];

/** The namespace of the IRIs a proof's N3 export names. */
export const PROOF_NAMESPACE = "urn:haibun:proof#";
