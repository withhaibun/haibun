import { TWorld, TProtoOptions, CStepper, DEFAULT_DEST, TExecutorResult, TEST_BASE } from '../defs.js';
import { createSteppers } from './../util/index.js';
import { getRunTag } from '../ttag.js';
import { getSteppers } from '../util/workspace-lib.js';
import Logger, { LOGGER_LOG } from '../Logger.js';
import { Timer } from '../Timer.js';
import { asFeatures } from '../resolver-features.js';
import { Runner } from '../../runner.js';
import { FeatureVariables } from '../feature-variables.js';
import { Prompter } from '../prompter.js';
import { getCoreDomains } from '../core-domains.js';

const DEF_PROTO_DEFAULT_OPTIONS = { DEST: DEFAULT_DEST };
export const DEF_PROTO_OPTIONS = { options: DEF_PROTO_DEFAULT_OPTIONS, moduleOptions: {} };

export const HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS = 'HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS';

export async function getCreateSteppers(steppers: string[], addSteppers?: CStepper[]) {
	const csteppers = await getSteppers(steppers);
	return await createSteppers(csteppers.concat(addSteppers || []));
}


type TTestFeatures = { path: string; content: string; base?: string }[];

export async function testWithDefaults(featuresIn: TTestFeatures | string, useSteppers: CStepper[], protoOptions: TProtoOptions = DEF_PROTO_OPTIONS, backgroundsIn: TTestFeatures = []) {
	const world = getTestWorldWithOptions(protoOptions);
	return await testWithWorld(world, featuresIn, useSteppers, backgroundsIn);
}

export async function testWithWorld(world: TWorld, featuresIn: TTestFeatures | string, useSteppers: CStepper[], backgroundsIn: TTestFeatures = []): Promise<TExecutorResult & { world: TWorld }> {
	if (useSteppers.length < 1) {
		throw Error('useSteppers must have at least one stepper');
	}
	const inFeatures = typeof featuresIn == 'string' ? [{ path: '/features/test', content: featuresIn }] : featuresIn;

	const withBases = (i) => (i.base ? i : { ...i, base: TEST_BASE });
	const features = asFeatures(inFeatures.map(withBases));
	const backgrounds = asFeatures(backgroundsIn.map(withBases));

	const ran = await new Runner(world).runFeaturesAndBackgrounds(useSteppers, { features, backgrounds });
	return { ...ran, world };
}

export function getTestWorldWithOptions(protoOptions: TProtoOptions = DEF_PROTO_OPTIONS, env = { HAIBUN_LOG_LEVEL: 'none' }) {
	const world = getDefaultWorld(0, env);
	if (protoOptions) {
		world.options = { ...protoOptions.options, envVariables: protoOptions.options.envVariables || {} };
		world.moduleOptions = protoOptions.moduleOptions;
	}
	// Allow test to override prompter after creation
	return world;
}

export function getDefaultWorld(sequence: number, env = process.env): TWorld {
	const world: Partial<TWorld> = {
		timer: new Timer(),
		tag: getRunTag(sequence, 0),
		logger: new Logger(env.HAIBUN_LOG_LEVEL ? { level: env.HAIBUN_LOG_LEVEL } : LOGGER_LOG),
		prompter: new Prompter(),
		runtime: {},
		options: { DEST: DEFAULT_DEST, envVariables: env },
		moduleOptions: {},
		bases: ['/features/'],
	};
	world.domains = getCoreDomains(world as TWorld);
	world.shared = new FeatureVariables(world as TWorld);
	return world as TWorld;
}

export function getDefaultTag(sequence: number, desc: string | undefined = undefined) {
	return getRunTag(sequence, -1, desc ? { desc } : undefined, false);
}
