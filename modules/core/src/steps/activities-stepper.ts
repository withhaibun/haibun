import { AStepper, IHasCycles, TStepperSteps, TFeatureStep, IStepperCycles, TStepperStep, CycleWhen, READING } from "../lib/steps/domains/stepper.js";
import type { TFeatures, TStepInput } from "../lib/actuality/domains/execution.js";
import { runSteppers, type TWorld } from "../lib/actuality/domains/world.js";
import { OK } from "../lib/domains/protocol.js";
import { actionNotOK, actionOKWithProducts, getActionable, errorDetail, dePolite } from "../lib/domains/util.js";
import { itemAt } from "../lib/domains/item-at.js";
import { DOMAIN_STATEMENT, DOMAIN_STATEMENT_LINES, DOMAIN_TITLE, DOMAIN_WAYPOINT_ARGUMENT } from "../lib/domains/domains.js";
import { Resolver, findFeatureStepsFromStatement } from "../lib/actuality/pipelines/resolver.js";
import { proveStatements, stepperContext } from "../lib/actuality/pipelines/step-dispatch.js";
import type { TWaypointEntry } from "../lib/domains/goal-resolution.js";
import { runRegistry } from "../lib/steps/pipelines/step-registry.js";
import { stepMethodName } from "../lib/steps/domains/step-method.js";
import { phraseParameters } from "../lib/steps/domains/phrase.js";
import { z } from "zod";
import { Access, LinkRelations, PersistedVertexSchema, type TDomainDefinition } from "../lib/domains/resources.js";
import { refDomainKey, type TIndividualRef } from "../lib/domains/domains.js";
import { ACTIVITIES_ACTIONS } from "./domains/activities-actions.js";
import { readEvery, recordOf } from "../lib/records/pipelines/record-reads.js";

// The steps this stepper always has. The stepper adds a step for each waypoint a feature declares and for each saved waypoint.
type TActivitiesFixedSteps = {
	saveWaypoint: TStepperStep;
	registerSavedWaypoints: TStepperStep;
	runSavedWaypoint: TStepperStep;
	activity: TStepperStep;
	waypointWithProof: TStepperStep;
	waypointLabel: TStepperStep;
	ensure: TStepperStep;
};

type TActivitiesStepperSteps = TStepperSteps & TActivitiesFixedSteps;

/** The source path a saved waypoint holds where the step that saves it doesn't have a source path. The statement that runs a
 *  saved waypoint also has this source path. */
const SAVED_WAYPOINT_SOURCE = "a saved waypoint";

export const SAVED_WAYPOINT_LABEL = "SavedWaypoint";
const SAVED_WAYPOINT_DOMAIN = "saved-waypoint";
const SavedWaypointSchema = PersistedVertexSchema.extend({
	/** The waypoint's outcome. The outcome is the waypoint's name. */
	id: z.string(),
	lines: z.array(z.string()),
	source: z.string(),
	generatedAtTime: z.string(),
});
type TSavedWaypoint = z.infer<typeof SavedWaypointSchema>;
/** A saved waypoint's record. It holds the outcome, the lines of the activity in order, and the source path. The outcome is the
 *  waypoint's name. `register the saved waypoints` reads these records after a restart. The type is a schema.org HowTo
 *  whose steps are the lines. */
export const savedWaypointDomainDefinition: TDomainDefinition = {
	selectors: [SAVED_WAYPOINT_DOMAIN],
	schema: SavedWaypointSchema,
	description: "A saved waypoint's outcome and the lines its activity runs. `register the saved waypoints` registers the waypoint again after a restart.",
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

/**
 * Declares a waypoint's rule from each `waypoint` statement and saved waypoint: a step whose reading applies the rule. The
 * logic engine proves `ensure H` as P ∨ (¬P ∧ [A]P): either the proof P holds, or the activity A runs and then P holds.
 */
export class ActivitiesStepper extends AStepper implements IHasCycles {
	description = "Define and reuse activities with waypoints and proofs";

	steppers: AStepper[] = [];
	private backgroundOutcomePatterns: Set<string> = new Set();
	private featureOutcomePatterns: Set<string> = new Set();
	private outcomeToFeaturePath: Map<string, string> = new Map();
	private featureSteps: Map<string, Record<string, TStepperStep>> = new Map();
	private currentFeaturePath: string = "";
	private lastFeaturePath: string = "";
	private lastResolutionPath: string = "";
	private backgroundSteps: Record<string, TStepperStep> = {};
	private inActivityBlock = false;

	cycles: IStepperCycles = {
		getConcerns: () => ({ domains: [savedWaypointDomainDefinition] }),
		startFeature: (startFeature) => {
			if (this.lastFeaturePath && this.lastFeaturePath !== startFeature.resolvedFeature.path) {
				const previousSteps = this.featureSteps.get(this.lastFeaturePath);
				if (previousSteps) {
					for (const outcome of Object.keys(previousSteps)) {
						delete this.steps[outcome];
					}
				}
			}

			const currentSteps = this.featureSteps.get(startFeature.resolvedFeature.path);
			if (currentSteps) {
				for (const [outcome, step] of Object.entries(currentSteps)) {
					this.steps[outcome] = step;
				}
			}
			for (const [outcome, step] of Object.entries(this.backgroundSteps)) {
				this.steps[outcome] = step;
			}

			this.currentFeaturePath = startFeature.resolvedFeature.path;
			this.inActivityBlock = false;
		},
		endFeature: () => {
			this.lastFeaturePath = this.currentFeaturePath;
			return Promise.resolve();
		},
	};
	cyclesWhen = { startFeature: CycleWhen.FIRST };

	/**
	 * The resolver calls this before each feature resolves. It removes the previous feature's waypoint steps, so a feature's
	 * lines don't resolve to another feature's outcomes. It adds the current feature's waypoint steps and the background
	 * waypoint steps.
	 */
	startFeatureResolution(path: string): void {
		this.inActivityBlock = false;
		if (this.lastResolutionPath && this.lastResolutionPath !== path) {
			const previousSteps = this.featureSteps.get(this.lastResolutionPath);
			if (previousSteps) {
				for (const outcome of Object.keys(previousSteps)) {
					delete this.steps[outcome];
				}
			}
		}

		const currentSteps = this.featureSteps.get(path);
		if (currentSteps) {
			for (const [outcome, step] of Object.entries(currentSteps)) {
				this.steps[outcome] = step;
			}
		}

		for (const [outcome, step] of Object.entries(this.backgroundSteps)) {
			this.steps[outcome] = step;
		}

		this.lastResolutionPath = path;
	}

	clearAllBackgroundSteps(): void {
		this.backgroundSteps = {};
		this.backgroundOutcomePatterns.clear();
	}

	readonly baseSteps = {
		saveWaypoint: {
			description:
				"Registers a waypoint whose activity is these lines. Actuality offers the waypoint as a step after this step runs. The step refuses a line that doesn't resolve to one step and an outcome that is already registered, before it registers a waypoint. Saving an outcome again with the same lines returns the existing record.",
			gwta: `save waypoint {outcome: ${DOMAIN_TITLE}} doing {statements: ${DOMAIN_STATEMENT_LINES}}`,
			capability: ACTIVITIES_ACTIONS.saveWaypoint,
			productsDomain: SAVED_WAYPOINT_DOMAIN,
			action: async ({ outcome, statements }: { outcome: string; statements: string[] }, featureStep: TFeatureStep) =>
				actionOKWithProducts(await this.saveWaypoint(outcome, statements, featureStep.source?.path ?? SAVED_WAYPOINT_SOURCE)),
		},
		registerSavedWaypoints: {
			description: "Registers each saved waypoint from its record, so actuality offers a waypoint saved before a restart again.",
			gwta: "register the saved waypoints",
			action: async () => {
				const saved = await readEvery(this.getWorld().shared.getStore(), { label: SAVED_WAYPOINT_LABEL });
				this.registerSavedWaypoints(saved.map((record) => SavedWaypointSchema.parse(record)));
				return OK;
			},
		},
		runSavedWaypoint: {
			description:
				"Runs a saved waypoint by its outcome, as calling its step does. A line written before the waypoint was saved uses this step in place of the waypoint's step. A line resolved on a host where the waypoint isn't registered uses this step in the same way.",
			gwta: `run the saved waypoint {waypoint: ${refDomainKey(SAVED_WAYPOINT_DOMAIN)}}`,
			capability: ACTIVITIES_ACTIONS.runSavedWaypoint,
			action: async ({ waypoint }: { waypoint: TIndividualRef }, featureStep: TFeatureStep) => {
				// Every saved waypoint's step requires ACTIVITIES_ACTIONS.runSavedWaypoint, and other outcomes' steps don't.
				if (this.steps[waypoint.id]?.capability !== ACTIVITIES_ACTIONS.runSavedWaypoint) return actionNotOK(`"${waypoint.id}" isn't a waypoint saved here`);
				const world = this.getWorld();
				const statement = findFeatureStepsFromStatement(waypoint.id, this.steppers, world, SAVED_WAYPOINT_SOURCE, [0]);
				const ran = await proveStatements(stepperContext(world, this.steppers), featureStep, statement);
				return ran.ok ? OK : actionNotOK(ran.errorMessage);
			},
		},
		activity: {
			gwta: `Activity: {activity: ${DOMAIN_TITLE}}`,
			action: () => OK,
			resolveFeatureLine: (line: string, path: string, _stepper: AStepper, _backgrounds: TFeatures, allLines?: string[], lineIndex?: number, actualSourcePath?: string) => {
				this.lastResolutionPath = path;

				if (line.match(/^Activity:/i)) {
					this.inActivityBlock = true;
					return true;
				}

				if (this.inActivityBlock) {
					if (line.match(/^(Feature|Scenario|Background|Activity):/i)) {
						this.inActivityBlock = false;
						return false;
					}

					if (line.match(/^waypoint\s+/i)) {
						// resolveWaypointCommon registers the outcome under path and sets the step's source path to actualSourcePath.
						this.resolveWaypointCommon(line, path, allLines, lineIndex, line.includes(" with "), actualSourcePath);

						let hasMoreWaypoints = false;
						if (allLines && lineIndex !== undefined) {
							for (let i = lineIndex + 1; i < allLines.length; i++) {
								const nextLine = (allLines[i] || "").trim();
								if (nextLine.match(/^(Feature|Scenario|Background|Activity):/i)) {
									break;
								}
								if (nextLine.match(/^waypoint\s+/i)) {
									hasMoreWaypoints = true;
									break;
								}
							}
						}

						if (!hasMoreWaypoints) {
							this.inActivityBlock = false;
						}

						return true;
					}

					return true;
				}

				return false;
			},
		},

		waypointWithProof: {
			gwta: `waypoint {outcome: ${DOMAIN_TITLE}} with {proof:${DOMAIN_STATEMENT}}`,
			precludes: ["ActivitiesStepper.waypointLabel"],
			description: "States a waypoint's rule, whose head holds where its proof holds. Where a feature reaches the line, its proof is proved.",
			reading: READING.waypoint,
		},

		waypointLabel: { gwta: `waypoint {outcome: ${DOMAIN_TITLE}}`, description: "States a waypoint whose activity runs where its line is proved.", reading: READING.waypoint },

		ensure: {
			description:
				"Proves a waypoint's head: where its proof doesn't hold, its activity runs and its proof is proved again, P ∨ (¬P ∧ [A]P). The record of the waypoint states each part of the proof.",
			gwta: `ensure {outcome:${DOMAIN_STATEMENT}}`,
			unique: true,
			reading: READING.ensure,
		},
	} as const satisfies TActivitiesFixedSteps;

	/** Returns the registered waypoints for the affordances snapshot (the ProvidesWaypoints capability). A waypoint is
	 *  ensured where its proof holds now, which this step proves beneath itself. */
	async waypointEntries(featureStep: TFeatureStep): Promise<TWaypointEntry[]> {
		const world = this.getWorld();
		const waypoints: TWaypointEntry[] = [];
		for (const [outcome, step] of Object.entries(this.steps)) {
			if (step.reading !== READING.apply || step.rule === undefined || step.source === undefined) continue;
			const proofStatements = step.rule.proof.map((line) => line.in);
			let ensured = false;
			let error: string | undefined;
			if (proofStatements.length > 0 && phraseParameters(outcome).length === 0) {
				const proof = step.rule.proof.flatMap((line) => findFeatureStepsFromStatement(line.in, this.steppers, world, line.source?.path, [0]));
				const proved = await proveStatements(stepperContext(world, this.steppers), featureStep, proof);
				ensured = proved.ok;
				if (!proved.ok) error = proved.errorMessage;
			}
			waypoints.push({
				outcome,
				method: stepMethodName("ActivitiesStepper", outcome),
				paramSlots: phraseParameters(outcome),
				proofStatements,
				ensured,
				...(error === undefined ? {} : { error }),
				source: step.source,
				isBackground: this.backgroundOutcomePatterns.has(outcome),
			});
		}
		return waypoints;
	}

	readonly typedSteps = this.baseSteps;

	steps: TActivitiesStepperSteps = { ...this.baseSteps };

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.steppers = steppers;
	}

	/**
	 * Registers a background waypoint whose activity is `lines`, so every feature has its step. Writes the waypoint as a
	 * record. Refreshes actuality's registry, which calls its change listeners where the steps changed. `source` is the
	 * source path the record holds. The outcome is `written` after dePolite, as a waypoint line's outcome is.
	 */
	async saveWaypoint(written: string, lines: string[], source: string): Promise<TSavedWaypoint> {
		const outcome = dePolite(written);
		const store = this.getWorld().shared.getStore();
		// The store holds a record for each saved waypoint. Saving an outcome again with the same lines returns the existing
		// record. registerSavedWaypoints throws for every other outcome that is already registered.
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

	/** Registers saved waypoints as `saveWaypoint` does, without writing their records again, and refreshes actuality's
	 *  registry once. Each step requires ACTIVITIES_ACTIONS.runSavedWaypoint. A delegation is made before the waypoint is
	 *  saved, so a delegation can't name an action specific to one waypoint. Throws before it registers any waypoint where
	 *  a line doesn't resolve to one step or an outcome is already registered. */
	private registerSavedWaypoints(saved: Pick<TSavedWaypoint, "id" | "lines" | "source">[]): void {
		const world = this.getWorld();
		const steppers = runSteppers(world);
		const resolver = new Resolver(steppers, []);
		const refused = saved.flatMap(({ id, lines }) => [
			...(this.steps[id] ? [`the outcome "${id}" is already registered`] : []),
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
			this.registerOutcome(id, [], source, { isBackground: true, activityBlockSteps: lines, capability: ACTIVITIES_ACTIONS.runSavedWaypoint });
		if (saved.length > 0) runRegistry(world).refresh(steppers, world);
	}

	/**
	 * Declares a waypoint's step: its pattern is the outcome, each placeholder of which takes a waypoint argument, and its
	 * rule holds the lines of its proof and its activity. An outcome is declared once; the same line declared again is the
	 * same waypoint.
	 */
	registerOutcome(
		outcome: string,
		proofStatements: string[],
		proofPath: string,
		{
			isBackground,
			activityBlockSteps,
			lineNumber,
			actualSourcePath,
			capability,
		}: {
			isBackground?: boolean;
			activityBlockSteps?: (string | TStepInput)[];
			lineNumber?: number;
			actualSourcePath?: string;
			/** The action the outcome's step requires, where it isn't the step's own name. */
			capability?: string;
		} = {},
	) {
		const path = actualSourcePath || proofPath;
		const existing = this.steps[outcome];
		if (existing) {
			if (existing.source?.path === path && existing.source?.lineNumber === lineNumber) return;
			throw new Error(
				`Outcome "${outcome}" is already registered. Each outcome can only be defined once. (Existing: ${existing.source?.path}:${existing.source?.lineNumber}, New: ${path}:${lineNumber})`,
			);
		}
		const lineOf = (line: string | TStepInput): TStepInput => (typeof line === "string" ? { in: line, source: { path } } : line);
		const rule = { proof: proofStatements.map(lineOf), activity: (activityBlockSteps ?? []).map(lineOf) };
		if (isBackground) this.backgroundOutcomePatterns.add(outcome);
		else {
			this.featureOutcomePatterns.add(outcome);
			this.outcomeToFeaturePath.set(outcome, proofPath);
		}
		const step: TStepperStep = {
			// Each placeholder in the outcome pattern takes a waypoint argument.
			gwta: outcome.replace(/\{([^}:]+)\}/g, (_, name: string) => `{${name}: ${DOMAIN_WAYPOINT_ARGUMENT}}`),
			virtual: true,
			...(capability ? { capability } : {}),
			source: { lineNumber, path },
			description: `Outcome: ${outcome}. Proof: ${proofStatements.join("; ")}`,
			reading: READING.apply,
			rule,
		};
		this.steps[outcome] = step;
		if (isBackground) this.backgroundSteps[outcome] = step;
		else {
			const steps = this.featureSteps.get(proofPath);
			if (steps) steps[outcome] = step;
			else this.featureSteps.set(proofPath, { [outcome]: step });
		}
	}

	private resolveWaypointCommon(
		line: string,
		path: string,
		allLines: string[] | undefined,
		lineIndex: number | undefined,
		requireProof: boolean,
		actualSourcePath?: string,
	): boolean {
		if (!line.match(/^waypoint\s+/i)) {
			return false;
		}

		let written: string;
		let proofStatements: string[] = [];

		if (requireProof) {
			if (!line.match(/^waypoint\s+.+?\s+with\s+/i)) {
				return false;
			}
			const withoutPrefix = line.replace(/^waypoint\s+/i, "");
			const lastWithIndex = withoutPrefix.lastIndexOf(" with ");
			if (lastWithIndex === -1) return false;

			written = withoutPrefix.substring(0, lastWithIndex).trim();
			const proofRaw = withoutPrefix.substring(lastWithIndex + 6).trim();
			proofStatements = proofRaw
				.split("\n")
				.map((s) => s.trim())
				.filter((s) => s.length > 0);
		} else {
			if (line.match(/^waypoint\s+.+?\s+with\s+/i)) {
				return false;
			}
			const match = line.match(/^waypoint\s+(.+?)$/i);
			if (!match) return false;
			written = itemAt(match, 1).trim();
		}
		// The resolver matches a line after dePolite removes its leading words, so the outcome is the written name after dePolite.
		const outcome = dePolite(written);

		if (this.backgroundOutcomePatterns.has(outcome) || this.featureOutcomePatterns.has(outcome)) {
			return true;
		}

		const isBackground = path.includes("backgrounds/");

		let activityBlockSteps: TStepInput[] | undefined;

		if (allLines && lineIndex !== undefined) {
			let activityStartLine = -1;
			for (let i = lineIndex - 1; i >= 0; i--) {
				const prevLine = getActionable(itemAt(allLines, i));
				if (prevLine.match(/^Activity:/i)) {
					activityStartLine = i;
					break;
				}
				if (prevLine.match(/^(Feature|Scenario|Background):/i)) {
					break;
				}
			}

			if (activityStartLine !== -1) {
				const blockLines: TStepInput[] = [];
				for (let i = activityStartLine + 1; i < lineIndex; i++) {
					const stepLine = getActionable(itemAt(allLines, i));
					if (stepLine && !stepLine.match(/^waypoint\s+/i)) {
						blockLines.push({ in: stepLine, source: { lineNumber: i + 1, path: actualSourcePath || path } });
					}
				}
				activityBlockSteps = blockLines;
			}
		}
		this.registerOutcome(outcome, proofStatements, path, { isBackground, activityBlockSteps, lineNumber: lineIndex !== undefined ? lineIndex + 1 : undefined, actualSourcePath });
		return true;
	}
}

export default ActivitiesStepper;
