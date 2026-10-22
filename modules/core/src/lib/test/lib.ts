import type { TWorld, TProtoOptions } from "../actuality/domains/world.js";
import { newActualityId } from "../transport/domains/rpc-wire.js";
import { CStepper } from "../steps/domains/stepper.js";
import { DEFAULT_DEST, LOGIC_STEPPER, LOGIC_STEPPER_NAME, TExecutorResult } from "../domains/protocol.js";
import { getRunTag } from "../domains/ttag.js";
import { DEFAULT_HOST_ID } from "../domains/host-id.js";
import { resolveSitePrincipal } from "../domains/host-id.js";
import { getCreateSteppers, getSteppers } from "../adapters/workspace-lib.js";
export { getCreateSteppers };
export { getDefaultTag } from "../domains/ttag.js";
import { actualityClock } from "../actuality/root.js";
import { actualityMachine } from "../actuality/machines/actuality.js";
import { asFeatures, TEST_BASE } from "./resolver-features.js";
import { Runner } from "../pipelines/runner.js";
import { proverOf } from "../actuality/pipelines/step-dispatch.js";
import type { TProver } from "../actuality/ports.js";
import { FeatureVariables, secretsOf } from "../actuality/pipelines/feature-variables.js";
import { Prompter } from "../prompts/pipelines/prompter.js";
import { consolePrompter } from "../prompts/root.js";
import { getCoreDomains } from "../pipelines/core-domains.js";
import assert from "assert";
import { createServer } from "node:net";
import { EventLogger } from "../steps/pipelines/event-logger.js";
import { eventSink } from "../steps/root.js";

const DEF_PROTO_DEFAULT_OPTIONS = { DEST: DEFAULT_DEST };
export const DEF_PROTO_OPTIONS = { options: DEF_PROTO_DEFAULT_OPTIONS, moduleOptions: {} };

export const HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS = "HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS";

type TTestFeatures = { path: string; content: string; base?: string }[];

export async function passWithDefaults(
	featuresIn: TTestFeatures | string,
	useSteppers: CStepper[],
	protoOptions: TProtoOptions = DEF_PROTO_OPTIONS,
	backgroundsIn: TTestFeatures = [],
) {
	const res = await testWithDefaults(featuresIn, useSteppers, protoOptions, backgroundsIn);
	if (!res.ok) {
		console.error(
			"🥺passWithDefaults",
			JSON.stringify(
				{
					failure: res.failure?.error.message || res.failure,
					featureResults: res.featureResults && res.featureResults.map((sr) => sr.stepResults.map((ar) => [ar.in, ar.ok].join(": "))),
				},
				null,
				2,
			),
		);
	}
	return res;
}
export async function failWithDefaults(
	featuresIn: TTestFeatures | string,
	useSteppers: CStepper[],
	protoOptions: TProtoOptions = DEF_PROTO_OPTIONS,
	backgroundsIn: TTestFeatures = [],
) {
	const res = await testWithDefaults(featuresIn, useSteppers, protoOptions, backgroundsIn);
	if (res.ok) {
		console.error("🥺failWithDefaults", JSON.stringify({ featureResults: res.featureResults }, null, 2));
	}
	return res;
}
async function testWithDefaults(featuresIn: TTestFeatures | string, useSteppers: CStepper[], protoOptions: TProtoOptions = DEF_PROTO_OPTIONS, backgroundsIn: TTestFeatures = []) {
	const world = getTestWorldWithOptions(protoOptions);
	return await testWithWorld(world, featuresIn, useSteppers, backgroundsIn);
}

export async function testWithWorld(
	world: TWorld,
	featuresIn: TTestFeatures | string,
	useSteppers: CStepper[],
	backgroundsIn: TTestFeatures = [],
): Promise<TExecutorResult & { world: TWorld }> {
	assert(useSteppers.length > 0, "useSteppers must have at least one stepper");
	const inFeatures = typeof featuresIn === "string" ? [{ path: "/features/test", content: featuresIn }] : featuresIn;

	const withBases = (i: { path: string; content: string; base?: string }) => (i.base ? i : { ...i, base: TEST_BASE });
	const features = asFeatures(inFeatures.map(withBases));
	const backgrounds = asFeatures(backgroundsIn.map(withBases));

	const ran = await new Runner(world).runFeaturesAndBackgrounds(await withLogic(useSteppers), { features, backgrounds });
	return { ...ran, world };
}

/** The logic engine's prover of a world a test builds, loaded on its first proof from the stepper a configuration lists. A
 *  test that builds its world and calls a step without running a feature proves the step through it. */
function testProver(): TProver {
	let loaded: Promise<TProver> | undefined;
	const load = async (): Promise<TProver> => {
		const [Logic] = await getSteppers([LOGIC_STEPPER]);
		if (Logic === undefined) throw new Error(`${LOGIC_STEPPER} didn't load; install @haibun/logic`);
		const scratch = { runtime: {} } as TWorld;
		await new Logic().setWorld(scratch, []);
		return proverOf(scratch);
	};
	const prover = (): Promise<TProver> => {
		if (loaded === undefined) loaded = load();
		return loaded;
	};
	return {
		prove: async (ctx, featureStep) => (await prover()).prove(ctx, featureStep),
		proveStatements: async (ctx, parent, statements, targetHostId) => (await prover()).proveStatements(ctx, parent, statements, targetHostId),
	};
}

/** A test's steppers with the logic engine's stepper, which every configuration lists, as config.base.json does. A test that
 *  passes the stepper's class uses it, so a test whose environment doesn't load a module by its path, such as jsdom's, runs. */
export async function withLogic(useSteppers: CStepper[]): Promise<CStepper[]> {
	if (useSteppers.some((stepper) => stepper.name === LOGIC_STEPPER_NAME)) return useSteppers;
	return [...useSteppers, ...(await getSteppers([LOGIC_STEPPER]))];
}

export function getTestWorldWithOptions(protoOptions: TProtoOptions = DEF_PROTO_OPTIONS, env = { HAIBUN_LOG_LEVEL: "none" }) {
	const world = getDefaultWorld(env);
	if (protoOptions) {
		world.options = { ...protoOptions.options, envVariables: protoOptions.options.envVariables || {} };
		world.moduleOptions = protoOptions.moduleOptions;
	}
	// Allow test to override prompter after creation
	return world;
}

/** An events hub that doesn't hold a secret and doesn't write to the console. A test reads its events through subscribers. */
export function eventHubOfTest(): EventLogger {
	const hub = new EventLogger({ values: () => [] }, eventSink(), false);
	hub.suppressConsole = true;
	return hub;
}

export function getDefaultWorld(env: NodeJS.ProcessEnv = process.env): TWorld {
	const world: Partial<TWorld> = {
		clock: actualityClock(),
		tag: getRunTag(0, undefined, {}, false, DEFAULT_HOST_ID),
		prompter: new Prompter(consolePrompter()),
		runtime: {
			actualityId: newActualityId(),
			actuality: actualityMachine(),
			levels: new Map(),
			stepResults: [],
			steps: { count: 0 },
			seqPaths: new Map(),
			steppers: [],
			feature: "test-feature",
			stepUsage: new Map(),
			keys: { principal: resolveSitePrincipal() },
			prover: testProver(),
		},
		options: { DEST: DEFAULT_DEST, envVariables: Object.fromEntries(Object.entries(env).flatMap(([name, value]) => (value === undefined ? [] : [[name, value]]))) },
		moduleOptions: {},
		bases: ["/features/"],
	};
	const eventLogger = new EventLogger(secretsOf(world), eventSink(), false);
	// A test doesn't write its events to the console.
	eventLogger.suppressConsole = true;
	world.eventLogger = eventLogger;
	world.domains = getCoreDomains(world as TWorld);
	world.shared = new FeatureVariables(world as TWorld);
	return world as TWorld;
}

/** A port that a server doesn't listen on now, so a test's server and another test file's never share one. */
export const freePort = (): Promise<number> =>
	new Promise((resolve, reject) => {
		const probe = createServer();
		probe.once("error", reject);
		probe.listen(0, "127.0.0.1", () => {
			const { port } = probe.address() as { port: number };
			probe.close(() => resolve(port));
		});
	});
