/**
 * The logic engine's declarations: what a query of a line's proof returns, the effects a proof requests, and the
 * derivation a proof writes as records.
 */
import { z } from "zod";
import { VERDICT } from "@haibun/core/lib/domains/protocol.js";
import type { TDomainDefinition } from "@haibun/core/lib/domains/resources.js";

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

/** A formula checked against the engine's fragment: its Unicode rendering, or why the fragment refuses it and the remedy. */
export const FormulaCheckedSchema = z.discriminatedUnion("accepted", [
	z.object({ accepted: z.literal(true), rendered: z.string() }),
	z.object({ accepted: z.literal(false), reason: z.string(), remedy: z.string() }),
]);
export type TFormulaChecked = z.infer<typeof FormulaCheckedSchema>;

export const DOMAIN_DERIVATION = "derivation";
export const DOMAIN_FORMULA_CHECK = "formula-check";
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
	{
		selectors: [DOMAIN_FORMULA_CHECK],
		schema: FormulaCheckedSchema,
		description: "A TPTP FOF formula checked against the engine's fragment: its Unicode rendering, or why it is refused and the remedy",
	},
];

/** The namespace of the IRIs a proof's N3 export names. */
export const PROOF_NAMESPACE = "urn:haibun:proof#";
