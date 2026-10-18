import { z } from "zod";
import type { TFeatures } from "../lib/actuality/domains/execution.js";
import type { TWorld } from "../lib/actuality/domains/world.js";
import { OK } from "../lib/domains/protocol.js";
import { AStepper, IHasCycles, TStepperSteps, TFeatureStep, IStepperCycles, TEndFeature, CycleWhen } from "../lib/steps/domains/stepper.js";
import { actionNotOK, actionOK, actionOKWithProducts } from "../lib/domains/util.js";
import { findFeatureStepsFromStatement } from "../lib/actuality/pipelines/resolver.js";
import {
	DOMAIN_BACKGROUND_NAMES,
	DOMAIN_DURATION,
	DOMAIN_LINE_COMMENT,
	DOMAIN_LINK,
	DOMAIN_PERSISTED_TYPES,
	DOMAIN_STATEMENT,
	DOMAIN_STEPPER_NAME,
	DOMAIN_TEXT,
	DOMAIN_TITLE,
	backgroundNamesSchema,
	createEnumDomainDefinition,
} from "../lib/domains/domains.js";
import { findFeatures } from "../lib/domains/features.js";
import { FlowRunner, inheritedMode } from "../lib/steps/pipelines/flow-runner.js";
import { QuadStore } from "../lib/steps/pipelines/quad-store.js";
import { remoteQuadStore } from "./root.js";
import { requestSigner } from "../lib/domains/session-authority.js";
import { SERVING } from "../lib/domains/serving.js";
import { discoverSteps } from "../lib/steps/pipelines/discover-steps.js";
import { runRegistry } from "../lib/steps/pipelines/step-registry.js";
import { stepMethodName } from "../lib/steps/domains/step-method.js";
import { DOMAIN_STEP_DETAIL, SHOW_STEPS_ACTION, SHOW_STEPS_DESCRIPTION, StepDetailSchema, StepDiscoverySchema, type TStepsQuery } from "../lib/steps/domains/step-discovery.js";
import { shownTo } from "../lib/domains/capability-context.js";
import { validateStep } from "../lib/pipelines/step-validation.js";
import { Access, SEQ_PATH_LABEL } from "../lib/domains/resources.js";
import { recordOf } from "../lib/records/pipelines/record-reads.js";
import { SEQ_PATH_FIELD, executionOf, formatRecordName } from "../lib/actuality/domains/seq-path.js";
import { itemAt } from "../lib/domains/item-at.js";

/** Whether a line resolves to one step, and the method of that step or why it doesn't resolve to exactly one. */
const StepValidationSchema = z.discriminatedUnion("valid", [z.object({ valid: z.literal(true), method: z.string() }), z.object({ valid: z.literal(false), error: z.string() })]);
/** The store `use store at` mounts: the site that serves it, and the types routed to it. */
const StoreInUseSchema = z.object({ site: z.string(), types: z.array(z.string()) });
/** Product domains of Haibun's own steps. */
const DOMAIN_STEP_DISCOVERY = "step-discovery";
const DOMAIN_STEP_VALIDATION = "step-validation";
const DOMAIN_STORE_IN_USE = "store-in-use";
const DOMAIN_STEP_DURATION = "step-duration";
/** A step's duration as its record states it: from the record's generation time to its end time. */
const StepDurationSchema = z.object({ step: z.string(), called: z.string(), durationMs: z.number().nonnegative() });
/** The fields of an ended step's record that its duration reads. */
const EndedStepSchema = z.object({
	[SEQ_PATH_FIELD.called]: z.string(),
	[SEQ_PATH_FIELD.generatedAtTime]: z.iso.datetime({ offset: true }),
	[SEQ_PATH_FIELD.endedAtTime]: z.iso.datetime({ offset: true }),
});

/** How `ends with` ends a feature. */
const DOMAIN_ENDING = "ending";
const ENDING = { ok: "OK", notOk: "not OK" } as const;
/** How long `until` waits before it runs its statements again. */
const UNTIL_RETRY_MS = 200;

class Haibun extends AStepper implements IHasCycles {
	description = "Core steps for features, scenarios, backgrounds, and prose";

	afterEverySteps: { [stepperName: string]: TFeatureStep[] } = {};
	steppers: AStepper[] = [];
	private held?: FlowRunner;
	private get runner(): FlowRunner {
		return this.madeWithWorld(this.held, "flow runner");
	}

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.steppers = steppers;
		this.held = new FlowRunner(world, steppers);
	}
	cycles: IStepperCycles = {
		getConcerns: () => ({
			domains: [
				{ selectors: [DOMAIN_STEP_DETAIL], schema: StepDetailSchema, description: "How much of each declaration a read of actuality's declarations returns." },
				{ selectors: [DOMAIN_STEP_DISCOVERY], schema: StepDiscoverySchema, description: "The steps, domains and steppers actuality declares that a read matched" },
				{ selectors: [DOMAIN_STEP_VALIDATION], schema: StepValidationSchema, description: "Whether a line resolves to exactly one step, and which" },
				{ selectors: [DOMAIN_STORE_IN_USE], schema: StoreInUseSchema, description: "The store `use store at` mounts, and the types routed to it" },
				{ selectors: [DOMAIN_STEP_DURATION], schema: StepDurationSchema, description: "A step's record, the action it called, and its duration in milliseconds" },
				createEnumDomainDefinition({ name: DOMAIN_ENDING, values: Object.values(ENDING), description: "How `ends with` ends a feature: OK or not OK" }),
			],
		}),
		startFeature: () => {
			this.afterEverySteps = {};
		},
		endFeature: (endFeature?: TEndFeature) => {
			// A federated source or a mounted remote store (`use store at`, `federate graph reads`) holds a connection scoped
			// to the feature. The world store drops each one when the feature closes, so the next feature's reads don't call a closed peer.
			if (!endFeature?.shouldClose) return Promise.resolve();
			const store = this.getWorld().shared?.getStore();
			if (store instanceof QuadStore) store.dropRemoteConnections();
			return Promise.resolve();
		},
		afterStep: async ({ featureStep }: { featureStep: TFeatureStep }) => {
			// The after-every statement runs after each step of the feature. A substep is part of one step, so running after
			// each substep would run the statement several times for one feature line.
			if (featureStep.isAfterEveryStep || featureStep.isSubStep) {
				return Promise.resolve({});
			}
			const afterEvery = this.afterEverySteps[featureStep.action.stepperName];
			let failed: string | undefined;
			if (afterEvery) {
				const stepsToRun = afterEvery.filter((aeStep) => aeStep.action.actionName !== featureStep.action.actionName);

				if (stepsToRun.length > 0) {
					const mode = inheritedMode(featureStep);
					// Marks these steps as afterEvery steps to prevent recursion.
					const markedSteps = stepsToRun.map((s) => ({ ...s, isAfterEveryStep: true }));
					const res = await this.runner.runSteps(markedSteps, { intent: { mode }, parentStep: featureStep });
					if (!res.ok) {
						failed = `a step run after every ${featureStep.action.stepperName} step failed: ${res.errorMessage}`;
					}
				}
			}
			return Promise.resolve({ failed });
		},
	};

	cyclesWhen = { startExecution: CycleWhen.LAST, startFeature: CycleWhen.LAST };

	steps = {
		useStoreAt: {
			gwta: `use store at {where: ${DOMAIN_LINK}} for {types: ${DOMAIN_PERSISTED_TYPES}}`,
			productsDomain: DOMAIN_STORE_IN_USE,
			// Mounts another instance's store for the given types. RemoteQuadStore sends writes and reads of those types over
			// the capability-gated store surface, so the serving site's store holds those records instead of this instance's
			// store. Each record has one store. requestSigner signs each call with actuality's invoker, under a delegation
			// the serving site issued to this process.
			action: async ({ where, types: graphs }: { where: string; types: string[] }) => {
				const store = this.getWorld().shared.getStore();
				if (!(store instanceof QuadStore)) return actionNotOK("use store at: the world store does not support backing registration");
				const remote = remoteQuadStore({ url: where, sign: requestSigner(this.getWorld().runtime), graphs });
				const site = await remote.connect();
				await store.registerStore(remote, graphs);
				return actionOKWithProducts({ site, types: graphs });
			},
		},

		onHost: {
			gwta: `on host {hostId: number}, {statement:${DOMAIN_STATEMENT}}`,
			productsOf: "statement",
			action: ({ hostId, statement }: { hostId: number; statement: TFeatureStep[] }, featureStep: TFeatureStep) => {
				const mode = inheritedMode(featureStep);
				return this.runner.runSteps(statement, { intent: { mode }, parentStep: featureStep, targetHostId: hostId });
			},
		},

		showSteps: {
			read: true,
			capability: SHOW_STEPS_ACTION,
			gwta: `show steps matching {text: ${DOMAIN_TEXT}} as {detail: ${DOMAIN_STEP_DETAIL}}`,
			description: SHOW_STEPS_DESCRIPTION,
			productsDomain: DOMAIN_STEP_DISCOVERY,
			action: ({ text, detail }: TStepsQuery) => {
				const world = this.getWorld();
				return actionOKWithProducts(discoverSteps(world, runRegistry(world), { text, detail }, shownTo()));
			},
		},

		validateStep: {
			read: true,
			readsAt: Access.public,
			gwta: `validate step {text: ${DOMAIN_TEXT}}`,
			description:
				"Whether a line resolves to exactly one of the steps the caller may call, and which method that step is; otherwise why the line doesn't resolve to one of them or resolves to more than one.",
			productsDomain: DOMAIN_STEP_VALIDATION,
			action: ({ text }: { text: string }) => {
				const validation = validateStep(text, this.steppers, shownTo());
				return actionOKWithProducts(
					"error" in validation ? { valid: false, error: validation.error } : { valid: true, method: stepMethodName(validation.action.stepperName, validation.action.actionName) },
				);
			},
		},

		stepDuration: {
			gwta: `duration of {statement: ${DOMAIN_STATEMENT}}`,
			description:
				"Runs a statement of one step, and returns the step's duration in milliseconds from the step's record: from its generation time to its end time. A statement that fails fails this step.",
			productsDomain: DOMAIN_STEP_DURATION,
			action: async ({ statement }: { statement: TFeatureStep[] }, featureStep: TFeatureStep) => {
				if (statement.length !== 1) return actionNotOK(`duration of: the statement holds ${statement.length} steps, and a duration is read from the record of one step`);
				const ran = await this.runner.runStep(itemAt(statement, 0), { parentStep: featureStep });
				if (!ran.ok) return actionNotOK(`duration of: the step failed: ${ran.errorMessage}`);
				const world = this.getWorld();
				const step = formatRecordName({ execution: executionOf(world.tag), path: ran.seqPath });
				const record = await recordOf(world.shared.getStore(), SEQ_PATH_LABEL, step);
				if (!record) return actionNotOK(`duration of: actuality doesn't hold the record ${step} of the step`);
				const ended = EndedStepSchema.parse(record);
				const durationMs = Date.parse(ended[SEQ_PATH_FIELD.endedAtTime]) - Date.parse(ended[SEQ_PATH_FIELD.generatedAtTime]);
				return actionOKWithProducts({ step, called: ended[SEQ_PATH_FIELD.called], durationMs });
			},
		},

		until: {
			description: 'Run statements again until they pass, and fail when they haven\'t passed within the duration, e.g. `until passes within "2s"`.',
			gwta: `until {statements:${DOMAIN_STATEMENT}} within {duration: ${DOMAIN_DURATION}}`,
			action: async ({ statements, duration }: { statements: TFeatureStep[]; duration: number }, featureStep: TFeatureStep) => {
				const mode = inheritedMode(featureStep);
				const ends = Date.now() + duration;
				for (;;) {
					const signal = await this.runner.runSteps(statements, { intent: { mode, usage: "polling" }, parentStep: featureStep });
					if (signal.ok) return OK;
					if (Date.now() >= ends) return actionNotOK(`the statements didn't pass within ${duration}ms: ${signal.errorMessage}`);
					await this.getWorld().clock.wait(UNTIL_RETRY_MS);
				}
			},
		},

		keepRunning: {
			exact: "this feature runs as a service until stopped",
			action: () => {
				// A service feature (an agent, a daemon) ends with this step, so the process keeps receiving SSE events,
				// holding server sockets open and polling. The action's promise doesn't resolve. A signal ends the process.
				// This step sets SERVING to mark the instance ready, since every earlier step of the feature has run. A caller
				// that waits only for the port would race the rest of the feature.
				this.getWorld().runtime[SERVING] = true;
				return new Promise(() => {
					// intentionally never resolves
				});
			},
		},

		backgrounds: {
			gwta: `Backgrounds: {names: ${DOMAIN_BACKGROUND_NAMES}}`,
			resolveFeatureLine: (line: string, _path: string, _stepper: AStepper, backgrounds: TFeatures) => {
				if (!line.match(/^Backgrounds:\s*/i)) {
					return false;
				}

				for (const bgName of backgroundNamesSchema.parse(line.replace(/^Backgrounds:\s*/i, ""))) {
					const bg = findFeatures(bgName, backgrounds);
					if (bg.length !== 1) {
						throw new Error(`can't find single "${bgName}.feature" from ${backgrounds.map((b) => b.path).join(", ")}`);
					}
				}
				return false;
			},
			action: async ({ names }: { names: string[] }, featureStep: TFeatureStep) => {
				const world = this.getWorld();
				// Prepends 'Backgrounds: ' so expandLine reads the line as a background directive.
				const expanded = findFeatureStepsFromStatement(`Backgrounds: ${names.join(", ")}`, this.steppers, world, featureStep.source?.path, featureStep.seqPath, 1);
				const mode = inheritedMode(featureStep);
				const result = await this.runner.runSteps(expanded, { intent: { mode }, parentStep: featureStep });
				return result.ok ? OK : actionNotOK(`backgrounds failed: ${result.errorMessage}`);
			},
		},
		nothing: { exact: "", action: () => OK },
		prose: { prose: true, action: () => OK },

		feature: {
			gwta: `Feature: {feature: ${DOMAIN_TITLE}}`,
			action: ({ feature }: { feature: string }) => {
				this.getWorld().runtime.feature = feature;
				return OK;
			},
		},
		scenario: {
			gwta: `Scenario: {scenario: ${DOMAIN_TITLE}}`,
			action: ({ scenario }: { scenario: string }) => {
				this.getWorld().runtime.scenario = scenario;
				return OK;
			},
		},
		endsWith: {
			gwta: `ends with {result: ${DOMAIN_ENDING}}`,
			action: ({ result }: { result: string }) => (result === ENDING.ok ? actionOK() : actionNotOK(`the feature states that it ends with ${result}, so this step fails`)),
		},
		pause: {
			description: 'Pause for a duration. Accepts seconds or milliseconds with an optional space, e.g. `pause for "2s"` or `pause for "30 ms"`.',
			gwta: `pause for {duration: ${DOMAIN_DURATION}}`,
			action: async ({ duration }: { duration: number }) => {
				await this.getWorld().clock.wait(duration);
				return OK;
			},
		},
		comment: { gwta: `;;{comment: ${DOMAIN_LINE_COMMENT}}`, action: () => OK },
		afterEveryStepper: {
			gwta: `after every {stepperName: ${DOMAIN_STEPPER_NAME}}, {statement: ${DOMAIN_STATEMENT}}`,
			action: ({ stepperName, statement }: { stepperName: string; statement: TFeatureStep[] }) => {
				this.afterEverySteps[stepperName] = statement;
				return OK;
			},
		},
	} as const satisfies TStepperSteps;
}
export default Haibun;
