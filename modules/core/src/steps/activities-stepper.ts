import { AStepper, IHasCycles, TFeatureStep, IStepperCycles, TStepperSteps, CycleWhen, READING, ruleStatedAt, type TWaypointRule } from "../lib/steps/domains/stepper.js";
import { runSteppers, type TWorld } from "../lib/actuality/domains/world.js";
import { OK } from "../lib/domains/protocol.js";
import { actionNotOK, actionOKWithProducts, getActionable, errorDetail, dePolite, getStepTerm } from "../lib/domains/util.js";
import { DOMAIN_STATEMENT, DOMAIN_STATEMENT_LINES, DOMAIN_STEPPER_NAME, DOMAIN_TITLE, DOMAIN_UNIVERSAL, DOMAIN_WAYPOINT_ARGUMENT, UNIVERSAL } from "../lib/domains/domains.js";
import { Resolver, findFeatureStepsFromStatement } from "../lib/actuality/pipelines/resolver.js";
import { proveStatements, stepperContext } from "../lib/actuality/pipelines/step-dispatch.js";
import type { TWaypointEntry } from "../lib/domains/goal-resolution.js";
import { stepMethodName } from "../lib/steps/domains/step-method.js";
import { phraseParts } from "../lib/steps/domains/phrase.js";
import { z } from "zod";
import { Access, LinkRelations, PersistedVertexSchema, type TDomainDefinition } from "../lib/domains/resources.js";
import { refDomainKey, type TIndividualRef } from "../lib/domains/domains.js";
import { ACTIVITIES_ACTIONS, ACTIVITIES_STEPPER } from "./domains/activities-actions.js";
import { readEvery, recordOf } from "../lib/records/pipelines/record-reads.js";
import { packageOf } from "./root.js";

/** The source path a saved waypoint holds where the step that saves it doesn't have a source path. */
const SAVED_WAYPOINT_SOURCE = "a saved waypoint";
/** The library of a saved waypoint's rule. */
const SAVED = "saved";
/** The directory of the backgrounds. A waypoint a background states applies in every feature. */
const BACKGROUNDS = "backgrounds/";
/** The line that opens an activity, the line that states a waypoint with its head and its proof, and a heading, which ends
 *  an activity. */
const ACTIVITY_LINE = /^Activity:/i;
const WAYPOINT_LINE = /^waypoint\s+(.+?)(?:\s+with\s+(.+))?$/i;
/** The line that states a universal rule. */
const UNIVERSAL_LINE = new RegExp(`^for every ${UNIVERSAL.source.slice(1)}`);
const HEADING_LINE = /^(Feature|Scenario|Pending scenario|Background|Activity):/i;
/** The step that ensures a waypoint, which the affordances offer for each waypoint. */
const ENSURE = stepMethodName(ACTIVITIES_STEPPER, "ensure");

export const SAVED_WAYPOINT_LABEL = "SavedWaypoint";
const SAVED_WAYPOINT_DOMAIN = "saved-waypoint";
const SavedWaypointSchema = PersistedVertexSchema.extend({
	/** The waypoint's head. */
	id: z.string(),
	lines: z.array(z.string()),
	source: z.string(),
	generatedAtTime: z.string(),
});
type TSavedWaypoint = z.infer<typeof SavedWaypointSchema>;
/** A saved waypoint's record. It holds the head, the lines of the activity in order, and the source path. ActivitiesStepper
 *  reads these records as each feature starts, so a waypoint saved before a restart applies again. The type is a schema.org
 *  HowTo whose steps are the lines. */
export const savedWaypointDomainDefinition: TDomainDefinition = {
	selectors: [SAVED_WAYPOINT_DOMAIN],
	schema: SavedWaypointSchema,
	description: "A saved waypoint's head and the lines its activity runs. Its rule is stated again as each feature starts after a restart.",
	topology: {
		persistedAs: SAVED_WAYPOINT_LABEL,
		accessLevel: Access.private,
		type: "schema:HowTo",
		id: "id",
		properties: { id: LinkRelations.IDENTIFIER.rel, lines: LinkRelations.STEP.rel, source: LinkRelations.SOURCE_PATH.rel },
		displayLabel: "id",
		sortColumns: { generatedAtTime: "TIMESTAMPTZ" },
	},
};

/** An activity's lines by their index: its `Activity:` line, the waypoint lines that state its rules, and its last line. */
type TActivityBlock = { start: number; waypoints: number[]; end: number };
const blocksOfLines = new WeakMap<readonly string[], TActivityBlock[]>();

/** Each activity that a feature's lines state, read once for each list of lines. An activity runs from its `Activity:` line to
 *  its last waypoint, or to the line before the next heading where it doesn't state a waypoint. */
function activityBlocks(lines: readonly string[]): TActivityBlock[] {
	const held = blocksOfLines.get(lines);
	if (held !== undefined) return held;
	const blocks: TActivityBlock[] = [];
	let open: { start: number; waypoints: number[] } | undefined;
	const close = (before: number) => {
		const last = open?.waypoints.at(-1);
		if (open !== undefined) blocks.push({ ...open, end: last === undefined ? before : last });
		open = undefined;
	};
	for (const [at, raw] of lines.entries()) {
		const line = getActionable(raw);
		if (HEADING_LINE.test(line)) {
			close(at - 1);
			if (ACTIVITY_LINE.test(line)) open = { start: at, waypoints: [] };
		} else if (open !== undefined && WAYPOINT_LINE.test(line)) open.waypoints.push(at);
	}
	close(lines.length - 1);
	blocksOfLines.set(lines, blocks);
	return blocks;
}

/** A waypoint's head as written after dePolite, as a line's words are matched, and its pattern, in which each placeholder that
 *  doesn't name a domain takes a waypoint argument. */
function headOf(written: string): Pick<TWaypointRule, "head" | "pattern"> {
	const head = dePolite(written);
	return { head, pattern: head.replace(/\{([^}:]+)\}/g, (_, name: string) => `{${name}: ${DOMAIN_WAYPOINT_ARGUMENT}}`) };
}

/**
 * Holds a waypoint's rule from each `waypoint` line of an activity, each universal and each saved waypoint, and the rules over
 * step records that `after every` states. A line that unifies with a rule's head resolves to the `apply` step, which holds the
 * rule. The logic engine proves `ensure H` as P ∨ (¬P ∧ [A]P): either the proof P holds, or the activity A runs and then P holds.
 */
export class ActivitiesStepper extends AStepper implements IHasCycles {
	description = "Define and reuse activities with waypoints and proofs";

	steppers: AStepper[] = [];
	/** Each rule a waypoint states. A feature's rule applies in that feature, and a background's or a saved one in every feature. */
	private rules: TWaypointRule[] = [];
	/** The feature whose lines resolve or run, whose rules apply. */
	private feature = "";

	cycles: IStepperCycles = {
		getConcerns: () => ({ domains: [savedWaypointDomainDefinition] }),
		// States each saved waypoint's rule from its record. A store opens as its feature starts, so this cycle runs last.
		startFeature: async ({ resolvedFeature }) => {
			this.feature = resolvedFeature.path;
			const held = new Set(this.rules.filter(({ saved }) => saved === true).map(({ head }) => head));
			const saved = (await readEvery(this.getWorld().shared.getStore(), { label: SAVED_WAYPOINT_LABEL })).map((record) => SavedWaypointSchema.parse(record));
			this.registerSavedWaypoints(saved.filter(({ id }) => !held.has(headOf(id).head)));
		},
		// A rule over step records reads the record of each step a feature's line states, so a substep doesn't apply it.
		afterStep: async ({ featureStep }) => {
			const { stepperName, actionName } = featureStep.action;
			if (featureStep.isSubStep === true) return undefined;
			const world = this.getWorld();
			const statements = this.inScope()
				.flatMap(({ after, proof }) => (after === stepperName ? proof.flatMap((line) => findFeatureStepsFromStatement(line.in, this.steppers, world, line.source?.path, [0])) : []))
				.filter((step) => step.action.actionName !== actionName);
			if (statements.length === 0) return undefined;
			const proved = await proveStatements(stepperContext(world, this.steppers), featureStep, statements);
			return proved.ok ? undefined : { failed: `a step run after every ${stepperName} step failed: ${proved.errorMessage}` };
		},
	};
	cyclesWhen = { startFeature: CycleWhen.LAST };

	/** The resolver calls this before each feature resolves, so the feature's lines unify with its own rules and the rules of
	 *  every feature. */
	startFeatureResolution(path: string): void {
		this.feature = path;
	}

	/** Removes the backgrounds' rules, so a background's current text states them again. */
	forgetBackgroundRules(): void {
		this.rules = this.rules.filter(({ scope, saved }) => scope !== undefined || saved === true);
	}

	readonly steps = {
		saveWaypoint: {
			description:
				"Saves a waypoint whose activity is these lines, and states its rule, which then applies in every feature. The step refuses a line that doesn't resolve to one step and a head that is already a rule's, before it states the rule. Saving a head again with the same lines returns the existing record.",
			gwta: `save waypoint {outcome: ${DOMAIN_TITLE}} doing {statements: ${DOMAIN_STATEMENT_LINES}}`,
			capability: ACTIVITIES_ACTIONS.saveWaypoint,
			productsDomain: SAVED_WAYPOINT_DOMAIN,
			action: async ({ outcome, statements }: { outcome: string; statements: string[] }, featureStep: TFeatureStep) =>
				actionOKWithProducts(await this.saveWaypoint(outcome, statements, featureStep.source?.path ?? SAVED_WAYPOINT_SOURCE)),
		},
		runSavedWaypoint: {
			description:
				"Runs a saved waypoint's lines in order under this step, by the waypoint's head. A line written before the waypoint was saved, or resolved on a host that doesn't hold the waypoint, uses this step in place of the head.",
			gwta: `run the saved waypoint {waypoint: ${refDomainKey(SAVED_WAYPOINT_DOMAIN)}}`,
			capability: ACTIVITIES_ACTIONS.runSavedWaypoint,
			action: async ({ waypoint }: { waypoint: TIndividualRef }, featureStep: TFeatureStep) => {
				const rule = this.rules.find(({ head, saved }) => saved === true && head === waypoint.id);
				if (rule === undefined) return actionNotOK(`"${waypoint.id}" isn't a waypoint saved here`);
				const world = this.getWorld();
				const lines = rule.activity.flatMap((line) => findFeatureStepsFromStatement(line.in, this.steppers, world, line.source?.path, [0]));
				const ran = await proveStatements(stepperContext(world, this.steppers), featureStep, lines);
				return ran.ok ? OK : actionNotOK(ran.errorMessage);
			},
		},
		activity: {
			gwta: `Activity: {activity: ${DOMAIN_TITLE}}`,
			action: () => OK,
			// An activity's lines are the activity of each waypoint it states, and don't run where the feature reaches them.
			resolveFeatureLine: (line: string, path: string, _stepper: AStepper, _backgrounds: unknown, allLines?: string[], lineIndex?: number, actualSourcePath?: string) => {
				if (allLines === undefined || lineIndex === undefined) return false;
				const block = activityBlocks(allLines).find(({ start, end }) => start <= lineIndex && lineIndex <= end);
				if (block === undefined) return false;
				if (block.waypoints.includes(lineIndex)) this.state(this.ruleOf(line, path, allLines, block.start, lineIndex, actualSourcePath));
				return true;
			},
		},
		waypointWithProof: {
			gwta: `waypoint {outcome: ${DOMAIN_TITLE}} with {proof:${DOMAIN_STATEMENT}}`,
			precludes: [`${ACTIVITIES_STEPPER}.waypointLabel`],
			description: "States a waypoint's rule, whose head holds where its proof holds. Where a feature reaches the line, its proof is proved.",
			reading: READING.waypoint,
		},
		waypointLabel: { gwta: `waypoint {outcome: ${DOMAIN_TITLE}}`, description: "States a waypoint whose activity runs where its line is proved.", reading: READING.waypoint },
		forEvery: {
			gwta: `for every {universal: ${DOMAIN_UNIVERSAL}}`,
			description: "States the rule H ← B, for every {x: D} where B, H: a line that unifies with the head H proves the body B, with x a member of D.",
			reading: READING.waypoint,
			// A universal states the rule of the waypoint line it reads as, its head's variable ranging over the domain.
			resolveFeatureLine: (line: string, path: string, _stepper: AStepper, _backgrounds: unknown, _allLines?: string[], at?: number, actualSourcePath?: string) => {
				const rule = line.replace(
					UNIVERSAL_LINE,
					(_, x: string, domain: string, body: string, head: string) => `waypoint ${head.replaceAll(`{${x}}`, `{${x}: ${domain}}`)} with ${body}`,
				);
				if (rule !== line && at !== undefined) this.state(this.ruleOf(rule, path, [], at, at, actualSourcePath));
				return false;
			},
		},
		afterEvery: {
			gwta: `after every {stepperName: ${DOMAIN_STEPPER_NAME}}, {statement: ${DOMAIN_STATEMENT}}`,
			description:
				"States a rule over step records: after each step of the stepper that a feature's line states, the statement is proved under that step, apart from a step of the statement's own action.",
			action: ({ stepperName }: { stepperName: string }, featureStep: TFeatureStep) => {
				const statement = getStepTerm(featureStep, "statement");
				if (statement === undefined) return actionNotOK(`${featureStep.in} doesn't state the statement its rule proves`);
				const source = featureStep.source === undefined ? { path: this.feature } : featureStep.source;
				this.state({
					head: `after every ${stepperName}`,
					pattern: "",
					proof: [{ in: statement, source }],
					activity: [],
					source,
					library: this.feature,
					scope: this.feature,
					after: stepperName,
				});
				return OK;
			},
		},
		ensure: {
			description:
				"Proves a waypoint's head: where its proof doesn't hold, its activity runs and its proof is proved again, P ∨ (¬P ∧ [A]P). The record of the waypoint states each part of the proof.",
			gwta: `ensure {outcome:${DOMAIN_STATEMENT}}`,
			unique: true,
			reading: READING.ensure,
		},
		apply: {
			description:
				"Applies the rule of a waypoint whose head a line unifies with: the head's pattern parses the line, and each placeholder takes the line's term. The line alone proves the rule's proof and runs its activity where the proof doesn't hold, P ∨ [A]. In a proof, the line is a goal that the rule's proof proves.",
			rules: () => this.inScope().filter(({ after }) => after === undefined),
			// A step's own pattern takes a line that a head starting with a placeholder also parses, such as not {head}.
			fallback: true,
			capability: ACTIVITIES_ACTIONS.applyWaypoint,
			reading: READING.apply,
		},
	} as const satisfies TStepperSteps;

	/** Returns the waypoints whose rules apply, for the affordances snapshot (the ProvidesWaypoints capability). A waypoint is
	 *  ensured where its proof holds now, which this step proves beneath itself. */
	async waypointEntries(featureStep: TFeatureStep): Promise<TWaypointEntry[]> {
		const world = this.getWorld();
		const waypoints: TWaypointEntry[] = [];
		for (const rule of this.inScope().filter(({ after }) => after === undefined)) {
			const paramSlots = phraseParts(rule.pattern).map(({ name }) => name);
			const proof = rule.proof.flatMap((line) => findFeatureStepsFromStatement(line.in, this.steppers, world, line.source?.path, [0]));
			const proved = proof.length > 0 && paramSlots.length === 0 ? await proveStatements(stepperContext(world, this.steppers), featureStep, proof) : undefined;
			const error = proved === undefined || proved.ok ? {} : { error: proved.errorMessage };
			const { head, source } = rule;
			const proofStatements = rule.proof.map((line) => line.in);
			waypoints.push({
				outcome: head,
				method: ENSURE,
				args: { outcome: head },
				paramSlots,
				proofStatements,
				ensured: proved?.ok === true,
				...error,
				source,
				isBackground: rule.scope === undefined,
			});
		}
		return waypoints;
	}

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.steppers = steppers;
	}

	/** The rules that apply in the feature whose lines resolve or run. */
	private inScope(): TWaypointRule[] {
		return this.rules.filter(({ scope }) => scope === undefined || scope === this.feature);
	}

	/** Holds a waypoint's rule. A rule stated again from the same line is the same rule. Throws where a rule of the same head
	 *  applies in its features already. */
	private state(rule: TWaypointRule): void {
		const held = this.rules.find(({ head, scope }) => head === rule.head && (scope === undefined || rule.scope === undefined || scope === rule.scope));
		if (held === undefined) this.rules.push(rule);
		else if (ruleStatedAt(held) !== ruleStatedAt(rule))
			throw new Error(`the waypoint "${rule.head}" is stated at ${ruleStatedAt(held)} and at ${ruleStatedAt(rule)}; state each waypoint once`);
	}

	/** The rule a waypoint line of an activity states: its head, its proof, and the activity's lines before it that don't state
	 *  a waypoint. A background's rule applies in every feature, and a feature's in that feature. */
	private ruleOf(line: string, path: string, lines: readonly string[], start: number, at: number, actualSourcePath: string | undefined): TWaypointRule {
		const stated = WAYPOINT_LINE.exec(line);
		const written = stated?.[1];
		if (written === undefined) throw new Error(`"${line}" doesn't state a waypoint; state it as waypoint {head} with {proof}`);
		const proof = stated?.[2];
		const source = actualSourcePath === undefined ? path : actualSourcePath;
		const activity = lines.slice(start + 1, at).flatMap((raw, offset) => {
			const statement = getActionable(raw);
			return statement === "" || WAYPOINT_LINE.test(statement) ? [] : [{ in: statement, source: { lineNumber: start + offset + 2, path: source } }];
		});
		// A background's rule is the library's whose package holds it, or its file's where a package doesn't hold it.
		const where = path.includes(BACKGROUNDS) ? { library: packageOf(source) ?? source } : { library: path, scope: path };
		return { ...headOf(written), proof: proof === undefined ? [] : [{ in: proof, source: { path: source } }], activity, source: { path: source, lineNumber: at + 1 }, ...where };
	}

	/**
	 * Saves a waypoint whose activity is `lines`, which applies in every feature, and writes it as a record. `source` is the
	 * source path the record holds. The head is `written` after dePolite, as a waypoint line's head is.
	 */
	async saveWaypoint(written: string, lines: string[], source: string): Promise<TSavedWaypoint> {
		const outcome = dePolite(written);
		const store = this.getWorld().shared.getStore();
		// The store holds a record for each saved waypoint. Saving a head again with the same lines returns the existing record.
		// registerSavedWaypoints throws for every other head that is already a rule's.
		const kept = await recordOf(store, SAVED_WAYPOINT_LABEL, outcome);
		if (kept) {
			const held = SavedWaypointSchema.parse(kept);
			if (held.lines.length === lines.length && held.lines.every((line, at) => line === lines[at])) return held;
		}
		const saved: TSavedWaypoint = { id: outcome, lines, source, generatedAtTime: new Date().toISOString() };
		this.registerSavedWaypoints([saved]);
		await store.upsertIndividual(SAVED_WAYPOINT_LABEL, saved);
		return saved;
	}

	/** States the rules of saved waypoints as `saveWaypoint` does, without writing their records again. Applying one requires
	 *  ACTIVITIES_ACTIONS.applyWaypoint, as applying any waypoint does, and running its lines ACTIVITIES_ACTIONS.runSavedWaypoint. Throws before it states any rule where a line doesn't
	 *  resolve to one step or a rule already has the head. */
	private registerSavedWaypoints(saved: Pick<TSavedWaypoint, "id" | "lines" | "source">[]): void {
		const resolver = new Resolver(runSteppers(this.getWorld()), []);
		const refused = saved.flatMap(({ id, lines }) => [
			...(this.inScope().some(({ head }) => head === id) ? [`the outcome "${id}" is already registered`] : []),
			...lines.flatMap((line) => {
				try {
					resolver.findSingleStepAction(line);
					return [];
				} catch (err) {
					return [`each line of a saved waypoint resolves to one step: ${errorDetail(err)}`];
				}
			}),
		]);
		if (refused.length > 0) throw new Error(refused.join("; "));
		for (const { id, lines, source } of saved)
			this.state({ ...headOf(id), proof: [], activity: lines.map((line) => ({ in: line, source: { path: source } })), source: { path: source }, library: SAVED, saved: true });
	}
}

export default ActivitiesStepper;
