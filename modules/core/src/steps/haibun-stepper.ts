import { z } from "zod";
import type { TFeatures } from "../lib/actuality/domains/actuality.js";
import type { TWorld } from "../lib/actuality/domains/world.js";
import { OK } from "../lib/domains/protocol.js";
import {
	AStepper,
	IHasCycles,
	TStepperSteps,
	TStepperStep,
	TFeatureStep,
	IStepperCycles,
	TEndFeature,
	READING,
	SCENARIO_HEADING,
	UNTIL_DURATION,
} from "../lib/steps/domains/stepper.js";
import { actionNotOK, actionOK, actionOKWithProducts } from "../lib/domains/util.js";
import { findFeatureStepsFromStatement } from "../lib/actuality/pipelines/resolver.js";
import {
	DOMAIN_BACKGROUND_NAMES,
	DOMAIN_DATE,
	DOMAIN_DURATION,
	DOMAIN_LINE_COMMENT,
	DOMAIN_LINK,
	DOMAIN_NUMBER,
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
import { DOMAIN_STEPPERS, SHOW_STEPPERS_LINE, SteppersSchema } from "../lib/steps/domains/steppers.js";
import { DOMAIN_DECLARED_STEPS, DeclaredStepsSchema, SHOW_DECLARED_STEPS_LINE } from "../lib/steps/domains/declared-steps.js";
import { discoverSteps, everyStepDeclared, listedSteppers } from "../lib/steps/pipelines/discover-steps.js";
import { runRegistry } from "../lib/steps/pipelines/step-registry.js";
import { stepMethodName } from "../lib/steps/domains/step-method.js";
import {
	DOMAIN_STEP_DEFINITIONS,
	DOMAIN_STEP_SUMMARIES,
	SHOW_STEP_DEFINITIONS_LINE,
	SHOW_STEPS_ACTION,
	SHOW_STEPS_LINE,
	STEP_DETAIL,
	StepDefinitionsSchema,
	StepSummariesSchema,
	type TStepDetail,
	type TStepValidation,
} from "../lib/steps/domains/step-discovery.js";
import { BOUND, boundedItems, countingItems, limitedItems, matchingItems, orderedItems, type TListing } from "../lib/domains/lists.js";
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
const DOMAIN_STEP_VALIDATION = "step-validation";
const DOMAIN_STORE_IN_USE = "store-in-use";
/** What the reads of actuality's declarations do, which their definitions state. */
const SHOW_STEPS_DESCRIPTION = `Lists the steps its caller may call: each step's method, pattern and description, the capability it requires and the link to its definition, with every domain and the steppers of the steps. A method names its stepper and a hyphen first. Narrow the list with the matching combinator, as in \`matching "GraphStepper-", ${SHOW_STEPS_LINE}\`, and read the definition of a step you call with ${SHOW_STEP_DEFINITIONS_LINE}.`;
const SHOW_STEP_DEFINITIONS_DESCRIPTION = `Lists the definitions of the steps its caller may call: each step's argument and product schemas and the link to its call, with every domain, the concern catalog and the registry's predicates, which a formula names. A step whose definition you read is one you may call. Read one step's definition with the matching combinator, as in \`matching "Haibun-showSteps", ${SHOW_STEP_DEFINITIONS_LINE}\`.`;
/** The list a read of actuality's declarations holds: its steps. */
const STEPS_LIST = { items: "steps" } as const;

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
				{
					selectors: [DOMAIN_STEP_SUMMARIES],
					schema: StepSummariesSchema,
					list: STEPS_LIST,
					description: "The steps a caller may call, with every domain and the steppers of the steps",
				},
				{
					selectors: [DOMAIN_STEP_DEFINITIONS],
					schema: StepDefinitionsSchema,
					list: STEPS_LIST,
					description: "The definitions of the steps a caller may call, with every domain, the concern catalog and the registry's predicates",
				},
				{ selectors: [DOMAIN_DECLARED_STEPS], schema: DeclaredStepsSchema, list: STEPS_LIST, description: "Every step actuality declares, with whether the caller may call it" },
				{ selectors: [DOMAIN_STEPPERS], schema: SteppersSchema, list: { items: "steppers" }, description: "Each stepper actuality loads, with what it does and its steps" },
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

	/** What actuality declares to the caller at a detail. */
	private discovered(detail: TStepDetail) {
		const world = this.getWorld();
		return actionOKWithProducts(discoverSteps(world, runRegistry(world), detail, shownTo()));
	}

	/** A list combinator: a read that proves its statement and returns the statement's products with the list they hold as
	 *  `listing` makes it from the line's arguments, which `args` states. Each step the statement holds is gated as it runs. */
	private listCombinator<A extends z.ZodType>(gwta: string, description: string, args: A, listing: (values: z.infer<A>) => TListing) {
		return {
			read: true,
			readsAt: Access.public,
			gwta,
			description,
			productsOf: "statement",
			// A list is the response; keeping it on the event too holds a second copy of it per read.
			retainProducts: false,
			transformsList: (list, values) => listing(args.parse(values))(list, values),
			action: ({ statement }: { statement: TFeatureStep[] }, featureStep: TFeatureStep) => proveStatements(stepperContext(this.getWorld(), this.steppers), featureStep, statement),
		} as const satisfies TStepperStep;
	}

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
			gwta: SHOW_STEPS_LINE,
			description: SHOW_STEPS_DESCRIPTION,
			productsDomain: DOMAIN_STEP_SUMMARIES,
			// The declarations are the response; keeping them on the event too holds a second copy of every step per read.
			retainProducts: false,
			action: () => this.discovered(STEP_DETAIL.summary),
		},
		showStepDefinitions: {
			read: true,
			capability: SHOW_STEPS_ACTION,
			gwta: SHOW_STEP_DEFINITIONS_LINE,
			description: SHOW_STEP_DEFINITIONS_DESCRIPTION,
			productsDomain: DOMAIN_STEP_DEFINITIONS,
			retainProducts: false,
			action: () => this.discovered(STEP_DETAIL.definition),
		},
		showSteppers: {
			read: true,
			capability: SHOW_STEPS_ACTION,
			gwta: SHOW_STEPPERS_LINE,
			description: "Lists each stepper actuality loads, with what it does and each of its steps as its key and its pattern, as the CLI's --show-steppers prints them.",
			productsDomain: DOMAIN_STEPPERS,
			retainProducts: false,
			action: () => actionOKWithProducts(listedSteppers(this.steppers)),
		},
		showDeclaredSteps: {
			read: true,
			capability: SHOW_STEPS_ACTION,
			gwta: SHOW_DECLARED_STEPS_LINE,
			description:
				"Lists every step actuality declares, whether or not its caller may call it: each step's method, stepper, line and description, the action it requires and the level it reads at, and whether this caller may call it. A step the caller can't call is shown so a link to it leads to why.",
			productsDomain: DOMAIN_DECLARED_STEPS,
			retainProducts: false,
			action: () => actionOKWithProducts(everyStepDeclared(runRegistry(this.getWorld()), shownTo())),
		},
		matching: this.listCombinator(
			`matching {text: ${DOMAIN_TEXT}}, {statement: ${DOMAIN_STATEMENT}}`,
			"Keeps the items of the statement's list that hold the text in any of their values, compared without regard to case, and counts them.",
			z.object({ text: z.string() }),
			({ text }) => matchingItems(text),
		),
		counting: this.listCombinator(
			`counting {statement: ${DOMAIN_STATEMENT}}`,
			"Returns how many items the statement's list holds, and whether that count is a floor, without the items.",
			z.object({}),
			() => countingItems,
		),
		limitedTo: this.listCombinator(
			`limited to {count: ${DOMAIN_NUMBER}}, {statement: ${DOMAIN_STATEMENT}}`,
			"Keeps the first items of the statement's list, up to the count. The count of the whole list stays.",
			z.object({ count: z.number() }),
			({ count }) => limitedItems(count),
		),
		orderedBy: this.listCombinator(
			`ordered by {field: ${DOMAIN_TEXT}}, {statement: ${DOMAIN_STATEMENT}}`,
			"Orders the items of the statement's list by the values of a field they hold: numbers by size and any other value by its text, with an item that doesn't hold the field last.",
			z.object({ field: z.string() }),
			({ field }) => orderedItems(field),
		),
		since: this.listCombinator(
			`since {time: ${DOMAIN_DATE}}, {statement: ${DOMAIN_STATEMENT}}`,
			"Keeps the records of the statement's list whose time is at or after the time, and counts them. A list that doesn't state its items' time is refused.",
			z.object({ time: z.date() }),
			({ time }) => boundedItems(BOUND.since, time),
		),
		before: this.listCombinator(
			`before {time: ${DOMAIN_DATE}}, {statement: ${DOMAIN_STATEMENT}}`,
			"Keeps the records of the statement's list whose time is before the time, and counts them. A list that doesn't state its items' time is refused.",
			z.object({ time: z.date() }),
			({ time }) => boundedItems(BOUND.before, time),
		),

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
