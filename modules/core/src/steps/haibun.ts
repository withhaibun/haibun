import { z } from "zod";
import type { TFeatures } from "../lib/execution.js";
import type { TWorld } from "../lib/world.js";
import { OK } from "../schema/protocol.js";
import { AStepper, IHasCycles, TStepperSteps, TFeatureStep, IStepperCycles, TResolvedFeature, TStartFeature, TEndFeature, CycleWhen } from "../lib/astepper.js";
import { actionNotOK, actionOK, actionOKWithProducts, constructorName, sleep } from "../lib/util/index.js";
import { findFeatureStepsFromStatement } from "../phases/Resolver.js";
import { DOMAIN_STATEMENT } from "../lib/domains.js";
import { findFeatures } from "../lib/features.js";
import { FlowRunner } from "../lib/core/flow-runner.js";
import { QuadStore } from "../lib/quad-store.js";
import { RemoteQuadStore } from "../lib/remote-quad-store.js";
import { SERVING } from "../lib/serving.js";

class Haibun extends AStepper implements IHasCycles {
	description = "Core steps for features, scenarios, backgrounds, and prose";

	afterEverySteps: { [stepperName: string]: TFeatureStep[] } = {};
	steppers: AStepper[] = [];
	resolvedFeature: TResolvedFeature;
	private runner: FlowRunner;

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.steppers = steppers;
		this.runner = new FlowRunner(world, steppers);
	}
	cycles: IStepperCycles = {
		startFeature({ resolvedFeature, index }: TStartFeature) {
			this.resolvedFeature = resolvedFeature;
			this.afterEverySteps = {};
		},
		endFeature: (endFeature?: TEndFeature) => {
			// A federated source or mounted remote store (use store at / federate graph reads) is bound to a
			// connection that does not outlive the feature; drop it so the next feature's reads never chase a dead peer.
			if (!endFeature?.shouldClose) return Promise.resolve();
			const store = this.getWorld().shared?.getStore();
			if (store instanceof QuadStore) store.dropRemoteConnections();
			return Promise.resolve();
		},
		afterStep: async ({ featureStep }: { featureStep: TFeatureStep }) => {
			if (featureStep.isAfterEveryStep) {
				return Promise.resolve({ failed: false });
			}
			const afterEvery = this.afterEverySteps[featureStep.action.stepperName];
			let failed = false;
			if (afterEvery) {
				const stepsToRun = afterEvery.filter((aeStep) => aeStep.action.actionName !== featureStep.action.actionName);

				if (stepsToRun.length > 0) {
					const mode = featureStep.intent?.mode ?? "authoritative";
					// Mark these steps as afterEvery steps to prevent recursion
					const markedSteps = stepsToRun.map((s) => ({ ...s, isAfterEveryStep: true }));
					const res = await this.runner.runSteps(markedSteps, { intent: { mode }, parentStep: featureStep });
					if (!res.ok) {
						failed = true;
					}
				}
			}
			return Promise.resolve({ failed });
		},
	};

	cyclesWhen = {
		startExecution: CycleWhen.LAST,
		startFeature: CycleWhen.LAST,
	};

	steps = {
		useStoreAt: {
			gwta: `use store at {where} for {types} with token {token}`,
			productsSchema: z.object({ site: z.string(), types: z.array(z.string()) }),
			// Mount another instance's store for the given types: writes route through and reads come back over the
			// capability-gated store surface, so this instance keeps those records in the serving site's store instead
			// of its own — one store, one custodian. The token is the delegated capability the serving site granted.
			action: async ({ where, types, token }: { where: string; types: string; token: string }) => {
				const store = this.getWorld().shared.getStore();
				if (!(store instanceof QuadStore)) return actionNotOK("use store at: the world store does not support backing registration");
				const graphs = types
					.split(",")
					.map((t) => t.trim())
					.filter((t) => t.length > 0);
				if (graphs.length === 0) return actionNotOK("use store at: no types given");
				const remote = new RemoteQuadStore({ url: where, token, graphs });
				const site = await remote.connect();
				await store.registerStore(remote, graphs);
				return actionOKWithProducts({ site, types: graphs });
			},
		},

		onHost: {
			gwta: `on host {hostId: number}, {statement:${DOMAIN_STATEMENT}}`,
			action: ({ hostId, statement }: { hostId: number; statement: TFeatureStep[] }, featureStep: TFeatureStep) => {
				const mode = featureStep.intent?.mode ?? "authoritative";
				return this.runner.runSteps(statement, { intent: { mode }, parentStep: featureStep, targetHostId: hostId });
			},
		},

		until: {
			gwta: `until {statements:${DOMAIN_STATEMENT}}`,
			action: async ({ statements }: { statements: TFeatureStep[] }, featureStep: TFeatureStep) => {
				let signal;
				const mode = featureStep.intent?.mode ?? "authoritative";
				do {
					signal = await this.runner.runSteps(statements, { intent: { mode, usage: "polling" }, parentStep: featureStep });
					if (!signal.ok) {
						await sleep(200);
					}
				} while (!signal.ok);
				return OK;
			},
		},

		keepRunning: {
			exact: "this feature runs as a service until stopped",
			action: () => {
				// Service-style features (agent, daemon) end with this step so the
				// process keeps doing whatever it was doing — receiving SSE events,
				// holding open server sockets, polling. The action's promise never
				// resolves; the process exits via signal.
				// Reaching this step is what makes the instance ready: everything its feature sets up has run. A caller
				// that waited only for the port would race with the rest of the feature.
				this.getWorld().runtime[SERVING] = true;
				return new Promise(() => {
					// intentionally never resolves
				});
			},
		},

		backgrounds: {
			gwta: "Backgrounds: {names}",
			resolveFeatureLine: (line: string, _path: string, _stepper: AStepper, backgrounds: TFeatures) => {
				if (!line.match(/^Backgrounds:\s*/i)) {
					return false;
				}

				const names = line.replace(/^Backgrounds:\s*/i, "").trim();
				const bgNames = names.split(",").map((a) => a.trim());

				for (const bgName of bgNames) {
					const bg = findFeatures(bgName, backgrounds);
					if (bg.length !== 1) {
						throw new Error(`can't find single "${bgName}.feature" from ${backgrounds.map((b) => b.path).join(", ")}`);
					}
				}
				return false;
			},
			action: async ({ names }: { names: string }, featureStep: TFeatureStep) => {
				const world = this.getWorld();
				// Prepend 'Backgrounds: ' so expandLine correctly recognizes this as a background directive
				const expanded = findFeatureStepsFromStatement(`Backgrounds: ${names}`, this.steppers, world, featureStep.source?.path, featureStep.seqPath, 1);
				const mode = featureStep.intent?.mode ?? "authoritative";
				const result = await this.runner.runSteps(expanded, { intent: { mode }, parentStep: featureStep });
				return result.ok ? OK : actionNotOK(`backgrounds failed: ${result.errorMessage}`);
			},
		},
		nothing: {
			exact: "",
			action: () => OK,
		},
		prose: {
			match: /^([A-Z].*[.!?:;]|[^a-zA-Z].*)$/,
			fallback: true,
			action: () => OK,
		},

		feature: {
			gwta: "Feature: {feature}",
			handlesUndefined: ["feature"],
			action: ({ feature }: { feature: string }) => {
				this.getWorld().runtime.feature = feature;
				return OK;
			},
		},
		scenario: {
			gwta: "Scenario: {scenario}",
			handlesUndefined: ["scenario"],
			action: ({ scenario }: { scenario: string }) => {
				this.getWorld().runtime.scenario = scenario;
				return OK;
			},
		},
		endsWith: {
			gwta: "ends with {result}",
			action: ({ result }: { result: string }) => (result.toUpperCase() === "OK" ? actionOK() : actionNotOK("ends with not ok")),
		},
		pause: {
			description: 'Pause for a duration. Accepts seconds or milliseconds with an optional space, e.g. `pause for "2s"` or `pause for "30 ms"`.',
			gwta: "pause for {duration: string}",
			action: async ({ duration }: { duration: string }) => {
				const match = /^(-?\d+(?:\.\d+)?)\s*(ms|s)$/.exec(duration.trim());
				if (!match) return actionNotOK(`pause: expected "<number>s" or "<number>ms", got: ${duration}`);
				const value = Number(match[1]);
				if (!Number.isFinite(value)) return actionNotOK(`pause: value is not finite: ${match[1]}`);
				await sleep(match[2] === "ms" ? value : value * 1000);
				return OK;
			},
		},
		comment: {
			gwta: ";;{comment}",
			handlesUndefined: ["comment"],
			action: () => OK,
		},
		afterEveryStepper: {
			precludes: [`Haibun.prose`],
			gwta: `after every {stepperName: string}, {statement: ${DOMAIN_STATEMENT}}`,
			handlesUndefined: ["stepperName"],
			action: ({ statement }: { stepperName: string; statement: TFeatureStep[] }, featureStep: TFeatureStep) => {
				const { term: stepperName } = featureStep.action.stepValuesMap.stepperName;
				const matchedStepper = this.steppers.find((s) => constructorName(s) === stepperName);
				if (!matchedStepper) {
					return actionNotOK(`Didn't find stepper "${stepperName}" from [${this.steppers.map((s) => constructorName(s)).join(", ")}]`);
				}
				// Use constructorName for consistent key (handles vitest naming)
				this.afterEverySteps[constructorName(matchedStepper)] = statement;
				return OK;
			},
		},
	} satisfies TStepperSteps;
}
export default Haibun;
