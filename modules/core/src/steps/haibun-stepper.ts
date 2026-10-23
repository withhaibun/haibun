import { z } from "zod";
import type { TFeatures } from "../lib/actuality/domains/actuality.js";
import type { TWorld } from "../lib/actuality/domains/world.js";
import { OK } from "../lib/domains/protocol.js";
import { AStepper, IHasCycles, TStepperSteps, TFeatureStep, IStepperCycles, TEndFeature, READING, SCENARIO_HEADING, UNTIL_DURATION } from "../lib/steps/domains/stepper.js";
import { actionNotOK, actionOK, actionOKWithProducts } from "../lib/domains/util.js";
import { findFeatureStepsFromStatement } from "../lib/actuality/pipelines/resolver.js";
import {
	DOMAIN_BACKGROUND_NAMES,
	DOMAIN_DURATION,
	DOMAIN_LINE_COMMENT,
	DOMAIN_LINK,
	DOMAIN_PERSISTED_TYPES,
	DOMAIN_STATEMENT,
	DOMAIN_TEXT,
	DOMAIN_TITLE,
	backgroundNamesSchema,
	createEnumDomainDefinition,
} from "../lib/domains/domains.js";
import { findFeatures } from "../lib/domains/features.js";
import { proveStatements, stepperContext } from "../lib/actuality/pipelines/step-dispatch.js";
import { QuadStore } from "../lib/steps/pipelines/quad-store.js";
import { remoteQuadStore } from "./root.js";
import { requestSigner } from "../lib/domains/session-authority.js";
import { SERVE_UNTIL_STOPPED, SERVING } from "../lib/domains/serving.js";
import { discoverSteps } from "../lib/steps/pipelines/discover-steps.js";
import { runRegistry } from "../lib/steps/pipelines/step-registry.js";
import { stepMethodName } from "../lib/steps/domains/step-method.js";
import {
	DOMAIN_STEP_DETAIL,
	SHOW_STEPS_ACTION,
	SHOW_STEPS_DESCRIPTION,
	StepDetailSchema,
	StepDiscoverySchema,
	type TStepValidation,
	type TStepsQuery,
} from "../lib/steps/domains/step-discovery.js";
import { shownTo } from "../lib/domains/capability-context.js";
import { validateStep } from "../lib/pipelines/step-validation.js";
import { Access } from "../lib/domains/resources.js";

/** Whether a line resolves to one step, as `TStepValidation` states it. The page reads that type only, so the schema stays here. */
const StepValidationSchema = z.discriminatedUnion("valid", [
	z.object({ valid: z.literal(true), method: z.string(), values: z.record(z.string(), z.string()) }),
	z.object({ valid: z.literal(false), error: z.string() }),
]) satisfies z.ZodType<TStepValidation>;

/** The store `use store at` mounts: the site that serves it, and the types routed to it. */
const StoreInUseSchema = z.object({ site: z.string(), types: z.array(z.string()) });
/** Product domains of Haibun's own steps. */
const DOMAIN_STEP_DISCOVERY = "step-discovery";
const DOMAIN_STEP_VALIDATION = "step-validation";
const DOMAIN_STORE_IN_USE = "store-in-use";

/** How `ends with` ends a feature. */
const DOMAIN_ENDING = "ending";
const ENDING = { ok: "OK", notOk: "not OK" } as const;

class Haibun extends AStepper implements IHasCycles {
	description = "Core steps for features, scenarios, backgrounds, and prose";

	steppers: AStepper[] = [];

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.steppers = steppers;
	}
	cycles: IStepperCycles = {
		getConcerns: () => ({
			domains: [
				{ selectors: [DOMAIN_STEP_DETAIL], schema: StepDetailSchema, description: "How much of each declaration a read of actuality's declarations returns." },
				{ selectors: [DOMAIN_STEP_DISCOVERY], schema: StepDiscoverySchema, description: "The steps, domains and steppers actuality declares that a read matched" },
				{ selectors: [DOMAIN_STEP_VALIDATION], schema: StepValidationSchema, description: "Whether a line resolves to exactly one step, and which" },
				{ selectors: [DOMAIN_STORE_IN_USE], schema: StoreInUseSchema, description: "The store `use store at` mounts, and the types routed to it" },
				createEnumDomainDefinition({ name: DOMAIN_ENDING, values: Object.values(ENDING), description: "How `ends with` ends a feature: OK or not OK" }),
			],
		}),
		endFeature: (endFeature?: TEndFeature) => {
			// A federated source or a mounted remote store (`use store at`, `federate graph reads`) holds a connection scoped
			// to the feature. The world store drops each one when the feature closes, so the next feature's reads don't call a closed peer.
			if (!endFeature?.shouldClose) return Promise.resolve();
			const store = this.getWorld().shared?.getStore();
			if (store instanceof QuadStore) store.dropRemoteConnections();
			return Promise.resolve();
		},
	};

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
			action: ({ hostId, statement }: { hostId: number; statement: TFeatureStep[] }, featureStep: TFeatureStep) =>
				proveStatements(stepperContext(this.getWorld(), this.steppers), featureStep, statement, hostId),
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
				if ("error" in validation) return actionOKWithProducts({ valid: false, error: validation.error });
				const { stepperName, actionName, stepValuesMap } = validation.action;
				const values = stepValuesMap === undefined ? {} : Object.fromEntries(Object.entries(stepValuesMap).map(([name, value]) => [name, value.term]));
				return actionOKWithProducts({ valid: true, method: stepMethodName(stepperName, actionName), values });
			},
		},

		until: {
			description: 'Proves the statements again until they hold, and is refuted where they haven\'t held within the duration, e.g. `until passes within "2s"`: ◇≤d P.',
			gwta: `until {statements:${DOMAIN_STATEMENT}} within {${UNTIL_DURATION}: ${DOMAIN_DURATION}}`,
			reading: READING.until,
		},

		keepRunning: {
			exact: SERVE_UNTIL_STOPPED,
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
				const expanded = findFeatureStepsFromStatement(`Backgrounds: ${names.join(", ")}`, this.steppers, world, featureStep.source?.path, featureStep.seqPath);
				const result = await proveStatements(stepperContext(world, this.steppers), featureStep, expanded);
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
			gwta: SCENARIO_HEADING,
			description:
				"Heads a scenario. A heading that starts with Pending states a requirement the steppers don't provide yet: its lines don't resolve or run, and actuality's summary counts the scenario as pending until its heading is Scenario:.",
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
	} as const satisfies TStepperSteps;
}
export default Haibun;
