import { TWorld, TFeatureStep, TProtoOptions, CStepper, DEFAULT_DEST, TExecutorResult } from '../defs.js';
import { Resolver } from '../../phases/Resolver.js';
import { getRunTag, verifyExtraOptions, createSteppers } from './../util/index.js';
import { getSteppers } from '../util/workspace-lib.js';
import { WorldContext } from '../contexts.js';
import { withNameType } from './../features.js';
import Logger, { LOGGER_LOG } from '../Logger.js';
import { Timer } from '../Timer.js';
import { asFeatures } from '../resolver-features.js';
import { Runner } from '../../runner.js';

const DEF_PROTO_DEFAULT_OPTIONS = { DEST: DEFAULT_DEST };
const DEF_PROTO_OPTIONS = { options: DEF_PROTO_DEFAULT_OPTIONS, moduleOptions: {} };

export const HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS = 'HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS';
export const TEST_BASE = 'test_base';

export async function getCreateSteppers(steppers: string[], addSteppers?: CStepper[]) {
	const csteppers = await getSteppers(steppers);
	return await createSteppers(csteppers.concat(addSteppers || []));
}

export const testVStep = (name: string, action, base = TEST_BASE): TFeatureStep => ({
	source: { ...withNameType(base, name, '') },
	in: name,
	seq: 0,
	action,
});

export async function getTestEnv(useSteppers: string[], test: string, world: TWorld) {
	const csteppers = await getSteppers(useSteppers);
	const steppers = await createSteppers(csteppers);
	await verifyExtraOptions({}, csteppers);

	const resolver = new Resolver(steppers, world);
	const actions = resolver.findActionableSteps(test);

	const vstep = testVStep('test', actions[0]);

	return { world, vstep, csteppers, steppers };
}
type TTestFeatures = { path: string; content: string; base?: string }[];

export async function testWithDefaults(
	featuresIn: TTestFeatures | string,
	useSteppers: CStepper[],
	protoOptions: TProtoOptions = DEF_PROTO_OPTIONS,
	backgroundsIn: TTestFeatures = []
): Promise<TExecutorResult & { world: TWorld }> {
	if (useSteppers.length < 1) {
		throw Error('useSteppers must have at least one stepper');
	}
	const inFeatures = typeof featuresIn == 'string' ? [{ path: '/features/test', content: featuresIn }] : featuresIn;
	const world = getTestWorldWithOptions(protoOptions);

	const withBases = (i) => (i.base ? i : { ...i, base: TEST_BASE });
	const features = asFeatures(inFeatures.map(withBases));
	const backgrounds = asFeatures(backgroundsIn.map(withBases));

	const ran = await new Runner(world).runFeaturesAndBackgrounds(useSteppers, { features, backgrounds });
	return { ...ran, world };
}

export function getTestWorldWithOptions(protoOptions: TProtoOptions, env = { HAIBUN_LOG_LEVEL: 'none' }) {
	const { world } = getDefaultWorld(0, env);
	if (protoOptions) {
		world.options = protoOptions.options;
		world.moduleOptions = protoOptions.moduleOptions;
	}
	return world;
}

export function getDefaultWorld(sequence: number, env = process.env): { world: TWorld } {
	return {
		world: {
			timer: new Timer(),
			tag: getRunTag(sequence, 0),
			shared: new WorldContext(getDefaultTag(sequence)),
			logger: new Logger(env.HAIBUN_LOG_LEVEL ? { level: env.HAIBUN_LOG_LEVEL } : LOGGER_LOG),
			runtime: {},
			options: { DEST: DEFAULT_DEST },
			moduleOptions: {},
			bases: ['/features/'],
		},
	};
}

export function getDefaultTag(sequence: number, desc: string | undefined = undefined) {
	return getRunTag(sequence, -1, desc ? { desc } : undefined, false);
}
