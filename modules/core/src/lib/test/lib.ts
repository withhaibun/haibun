import { TWorld, TProtoOptions, CStepper } from '../defs.js';
import { DEFAULT_DEST, TExecutorResult, TEST_BASE } from '../../schema/protocol.js';
import { createSteppers } from './../util/index.js';
import { getRunTag } from '../ttag.js';
import { getSteppers } from '../util/workspace-lib.js';
import { Timer } from '../../schema/protocol.js';
import { asFeatures } from '../resolver-features.js';
import { Runner } from '../../runner.js';
import { FeatureVariables } from '../feature-variables.js';
import { Prompter } from '../prompter.js';
import { getCoreDomains } from '../core-domains.js';
import assert from 'assert';
import { EventLogger } from '../EventLogger.js';

const DEF_PROTO_DEFAULT_OPTIONS = { DEST: DEFAULT_DEST };
export const DEF_PROTO_OPTIONS = { options: DEF_PROTO_DEFAULT_OPTIONS, moduleOptions: {} };

export const HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS = 'HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS';

export async function getCreateSteppers(steppers: string[], addSteppers?: CStepper[]) {
	const csteppers = await getSteppers(steppers);
	return createSteppers(csteppers.concat(addSteppers || []));
}


type TTestFeatures = { path: string; content: string; base?: string }[];

export async function passWithDefaults(featuresIn: TTestFeatures | string, useSteppers: CStepper[], protoOptions: TProtoOptions = DEF_PROTO_OPTIONS, backgroundsIn: TTestFeatures = []) {
	const res = await testWithDefaults(featuresIn, useSteppers, protoOptions, backgroundsIn);
	if (!res.ok) {
		console.error('🥺passWithDefaults', JSON.stringify({ failure: res.failure?.error.message || res.failure, featureResults: res.featureResults && res.featureResults.map(sr => sr.stepResults.map(ar => ([ar.in, ar.ok].join(': ')))) }, null, 2));
	}
	return res;
}
export async function failWithDefaults(featuresIn: TTestFeatures | string, useSteppers: CStepper[], protoOptions: TProtoOptions = DEF_PROTO_OPTIONS, backgroundsIn: TTestFeatures = []) {
	const res = await testWithDefaults(featuresIn, useSteppers, protoOptions, backgroundsIn);
	if (res.ok) {
		console.error('🥺failWithDefaults', JSON.stringify({ featureResults: res.featureResults }, null, 2));
	}
	return res;
}
async function testWithDefaults(featuresIn: TTestFeatures | string, useSteppers: CStepper[], protoOptions: TProtoOptions = DEF_PROTO_OPTIONS, backgroundsIn: TTestFeatures = []) {
	const world = getTestWorldWithOptions(protoOptions);
	return await testWithWorld(world, featuresIn, useSteppers, backgroundsIn);
}

export async function testWithWorld(world: TWorld, featuresIn: TTestFeatures | string, useSteppers: CStepper[], backgroundsIn: TTestFeatures = []): Promise<TExecutorResult & { world: TWorld }> {
	assert(useSteppers.length > 0, 'useSteppers must have at least one stepper')
	const inFeatures = typeof featuresIn == 'string' ? [{ path: '/features/test', content: featuresIn }] : featuresIn;

	const withBases = (i) => (i.base ? i : { ...i, base: TEST_BASE });
	const features = asFeatures(inFeatures.map(withBases));
	const backgrounds = asFeatures(backgroundsIn.map(withBases));

	const ran = await new Runner(world).runFeaturesAndBackgrounds(useSteppers, { features, backgrounds });
	return { ...ran, world };
}

export function getTestWorldWithOptions(protoOptions: TProtoOptions = DEF_PROTO_OPTIONS, env = { HAIBUN_LOG_LEVEL: 'none' }) {
	const world = getDefaultWorld(env);
	if (protoOptions) {
		world.options = { ...protoOptions.options, envVariables: protoOptions.options.envVariables || {} };
		world.moduleOptions = protoOptions.moduleOptions;
	}
	// Allow test to override prompter after creation
	return world;
}

export function getDefaultWorld(env = process.env): TWorld {
	const eventLogger = new EventLogger();
	eventLogger.suppressConsole = true; // Suppress NDJSON in tests
	const world: Partial<TWorld> = {
		timer: new Timer(),
		tag: getRunTag(0),
		eventLogger,
		prompter: new Prompter(),
		runtime: { stepResults: [], feature: 'test-feature' },
		options: { DEST: DEFAULT_DEST, envVariables: env },
		moduleOptions: {},
		bases: ['/features/'],
	};
	world.domains = getCoreDomains(world as TWorld);
	world.shared = new FeatureVariables(world as TWorld);
	return world as TWorld;
}

export function getDefaultTag(desc: string | undefined = undefined) {
	return getRunTag(0, undefined, desc ? { desc } : undefined, false);
}
