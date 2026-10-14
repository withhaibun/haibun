import type { TWorld, TProtoOptions } from "../actuality/domains/world.js";
import { newActualityId } from "../transport/ports.js";
import { CStepper } from "../steps/domains/stepper.js";
import { DEFAULT_DEST, TExecutorResult, TEST_BASE } from "../../schema/protocol.js";
import { getRunTag } from "../ttag.js";
import { resolveSitePrincipal } from "../host-id.js";
import { getCreateSteppers } from "../util/node/workspace-lib.js";
export { getCreateSteppers };
export { getDefaultTag } from "../ttag.js";
import { actualityClock } from "../actuality/root.js";
import { actualityMachine } from "../actuality/machines/actuality.js";
import { asFeatures } from "../resolver-features.js";
import { Runner } from "../../runner.js";
import { FeatureVariables, secretsOf } from "../actuality/pipelines/feature-variables.js";
import { Prompter } from "../prompter.js";
import { getCoreDomains } from "../core-domains.js";
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

	const ran = await new Runner(world).runFeaturesAndBackgrounds(useSteppers, { features, backgrounds });
	return { ...ran, world };
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
		tag: getRunTag(0),
		prompter: new Prompter(),
		runtime: {
			actualityId: newActualityId(),
			actuality: actualityMachine(),
			stepResults: [],
			steps: { count: 0 },
			seqPaths: new Map(),
			steppers: [],
			feature: "test-feature",
			stepUsage: new Map(),
			keys: { principal: resolveSitePrincipal() },
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
