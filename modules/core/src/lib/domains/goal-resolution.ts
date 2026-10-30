/**
 * The declarations of goals that the logic engine proves over producer rules and that views read: a goal's resolution and
 * its plans, a plan's progress toward a goal, the applicable steps, the step graph's lint findings, and the waypoint entries a
 * stepper contributes to the affordances.
 */
import { z } from "zod";
import type { TFeatureStep } from "../steps/domains/stepper.js";
import type { TDomainDefinition } from "./resources.js";
import { VERDICT } from "./protocol.js";
import { DomainKeySchema, NameSchema, type TDomainKey } from "./domains.js";
import { ActionSchema } from "./actions.js";
import { StepMethodSchema } from "../steps/domains/step-method.js";
import { ACTUALITY_FIELD } from "../actuality/domains/seq-path.js";

export const DOMAIN_GOAL_RESOLUTION = "goal-resolution";
export const DOMAIN_APPLICABLE_STEPS = "applicable-steps";
export const DOMAIN_PLAN_PROGRESS = "plan-progress";
export const DOMAIN_PLAN_ID = "plan-id";

/** The source of a step that doesn't take a domain, which the chain view draws as the origin of its edge. */
export const SOURCE_DOMAIN = "∅";

/** A composite field's binding: a fact, a value a caller supplies, or the bindings of a composite's own fields. */
/** A composite field's domain, or empty for a primitive field that doesn't state one. */
export const FieldDomainSchema = DomainKeySchema.or(z.literal(""));
const fieldBase = { fieldName: z.string(), fieldDomain: FieldDomainSchema, fieldType: z.string(), optional: z.boolean() };
type TFieldBase = { fieldName: string; fieldDomain: TDomainKey | ""; fieldType: string; optional: boolean };
export type TFieldBinding = TFieldBase & ({ kind: "fact"; factId: string } | { kind: "argument" } | { kind: "composite"; fields: TFieldBinding[] });
const FieldBindingSchema: z.ZodType<TFieldBinding> = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("fact"), ...fieldBase, factId: z.string() }).strict(),
	z.object({ kind: z.literal("argument"), ...fieldBase }).strict(),
	z.object({ kind: z.literal("composite"), ...fieldBase, fields: z.array(z.lazy(() => FieldBindingSchema)) }).strict(),
]);

const BindingSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("fact"), domain: DomainKeySchema, factId: z.string() }).strict(),
	z.object({ kind: z.literal("argument"), domain: DomainKeySchema }).strict(),
	z.object({ kind: z.literal("composite"), domain: DomainKeySchema, fields: z.array(FieldBindingSchema) }).strict(),
]);
export type TBinding = z.infer<typeof BindingSchema>;

/** A plan: the steps a proof of a goal leaves to call, in the order their products are taken, and how each input holds. */
export const PlanSchema = z
	.object({
		steps: z.array(z.object({ stepperName: z.string(), stepName: z.string(), gwta: z.string().optional(), productsDomain: z.string() }).strict()),
		bindings: z.array(BindingSchema),
	})
	.strict();
export type TPlan = z.infer<typeof PlanSchema>;

/** A goal's resolution: proved where a fact of its domain holds, and else unknown, since a fact the records don't hold may hold
 *  elsewhere. A goal without a plan states the sub-goals from it down to the first it couldn't prove, and why that one isn't
 *  proved and what proves it. */
export const GoalResolutionSchema = z
	.object({
		goal: z.string(),
		verdict: z.enum([VERDICT.proved, VERDICT.unknown]),
		factIds: z.array(z.string()),
		plans: z.array(PlanSchema),
		unmet: z.string().optional(),
		unmetChain: z.array(DomainKeySchema).optional(),
		/** A proved goal's proof as statements in proof order: the line that asserted its fact, then the goal's statement. */
		statements: z.array(z.string()).optional(),
	})
	.strict();
export type TGoalResolution = z.infer<typeof GoalResolutionSchema>;

/** A plan's statuses: its goal isn't proved yet, or a fact of its goal holds. */
export const PLAN_STATUS = { running: "running", ended: "ended" } as const;

/** A plan toward a goal, which calls one of its steps per advance: the step it calls next, the parameters that step
 *  takes from the caller, and the facts its calls asserted. */
export const PlanProgressSchema = z
	.object({ plan: z.string(), goal: z.string(), status: z.enum(PLAN_STATUS), next: z.string().optional(), needs: z.array(z.string()), factIds: z.array(z.string()) })
	.strict();
export type TPlanProgress = z.infer<typeof PlanProgressSchema>;

/** A step the caller may call that takes or returns a domain, with whether each domain it takes holds. */
const ForwardSchema = z
	.object({
		method: StepMethodSchema,
		stepperName: z.string(),
		stepName: z.string(),
		gwta: z.string().optional(),
		inputDomains: z.array(DomainKeySchema),
		outputDomains: z.array(DomainKeySchema),
		readyToRun: z.boolean(),
		capability: ActionSchema,
	})
	.strict();
export type TForwardAffordance = z.infer<typeof ForwardSchema>;

/** Each composite domain's fields, by the domain each ranges over, as `topology.ranges` declares them. */
const CompositeRangesSchema = z.record(z.string(), z.record(z.string(), z.string()));
export type TCompositeRanges = z.infer<typeof CompositeRangesSchema>;

/** A waypoint a stepper offers, ensured where its proof holds now, with its description, the step that ensures it and the
 *  arguments it takes. */
const WaypointEntrySchema = z
	.object({
		outcome: z.string(),
		description: z.string(),
		method: z.string(),
		args: z.record(z.string(), z.string()),
		paramSlots: z.array(z.string()),
		proofStatements: z.array(z.string()),
		ensured: z.boolean(),
		error: z.string().optional(),
		source: z.object({ path: z.string(), lineNumber: z.number().optional() }).strict(),
		isBackground: z.boolean(),
	})
	.strict();
export type TWaypointEntry = z.infer<typeof WaypointEntrySchema>;

/** A stepper that contributes waypoint entries to the affordances. */
export interface ProvidesWaypoints {
	waypointEntries(featureStep: TFeatureStep): Promise<TWaypointEntry[]>;
}
export const providesWaypoints = <T>(s: T): s is T & ProvidesWaypoints => typeof (s as { waypointEntries?: unknown })?.waypointEntries === "function";

/** The steps on offer, the resolution of each goal a step returns, the facts of each domain, the composites' fields, the
 *  waypoints, and the actuality whose facts they read. A fact's id is the path of the step that asserted it. */
const snapshot = {
	forward: z.array(ForwardSchema),
	goals: z.array(z.object({ domain: DomainKeySchema, description: z.string(), resolution: GoalResolutionSchema }).strict()),
	satisfiedDomains: z.array(DomainKeySchema),
	satisfiedFacts: z.record(z.string(), z.array(z.string())),
	composites: CompositeRangesSchema,
	[ACTUALITY_FIELD]: z.string(),
};
/** The kinds of the step graph's lint findings, each a way the graph is incomplete. */
export const LINT_FINDING = { UNSUPPLIED_STEP: "unsupplied-step", UNREACHABLE_DOMAIN: "unreachable-domain", UNPRODUCED_DOMAIN: "unproduced-domain" } as const;
export const LintFindingSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal(LINT_FINDING.UNSUPPLIED_STEP), stepperName: z.string(), stepName: z.string(), inputDomain: DomainKeySchema }).strict(),
	z.object({ kind: z.literal(LINT_FINDING.UNREACHABLE_DOMAIN), domain: DomainKeySchema }).strict(),
	z.object({ kind: z.literal(LINT_FINDING.UNPRODUCED_DOMAIN), domain: DomainKeySchema }).strict(),
]);
export type TLintFinding = z.infer<typeof LintFindingSchema>;

/** A finding as one line: its kind, then the step or domain it names. */
export const lintFindingLine = (finding: TLintFinding): string =>
	finding.kind === LINT_FINDING.UNSUPPLIED_STEP
		? `${finding.kind} ${finding.stepperName}.${finding.stepName} consumes ${finding.inputDomain}`
		: `${finding.kind} ${finding.domain}`;

/** The affordances: the snapshot, the waypoints, and the step graph's lint findings, the ways the steps' chain is incomplete. */
export const AffordancesSchema = z.object({ ...snapshot, waypoints: z.array(WaypointEntrySchema), findings: z.array(LintFindingSchema) }).strict();
export type TAffordances = z.infer<typeof AffordancesSchema>;

export const goalDomainDefinitions: TDomainDefinition[] = [
	{ selectors: [DOMAIN_PLAN_ID], schema: NameSchema, description: "The id of a plan toward a goal. Each advance of the plan names this id." },
	{
		selectors: [DOMAIN_GOAL_RESOLUTION],
		schema: GoalResolutionSchema,
		description: "A goal's verdict over the producer rules, the facts that prove it, the plans that would prove it, and the statements of a failed proof.",
	},
	{
		selectors: [DOMAIN_APPLICABLE_STEPS],
		schema: AffordancesSchema,
		description: "The steps the caller may call next, each with whether its inputs hold, the resolution of each goal, and the step graph's lint findings.",
		ui: { component: "shu-affordances-panel", summary: "Affordances" },
	},
	{ selectors: [DOMAIN_PLAN_PROGRESS], schema: PlanProgressSchema, description: "A plan toward a goal, which calls one of its steps per advance." },
];
