/*import {
	TStartRunCallback,
	TProtoOptions,
	TSpecl,
	TWorld,
	TTag,
	TRunOptions,
	TRunResult,
	TTagValue,
	TEndFeatureCallback,
	TBase,
} from './defs.js';
import { WorldContext } from './contexts.js';
import Logger from './Logger.js';

import { run } from './run.js';
import { getRunTag } from './util/index.js';
import { getOutputResult } from './util/workspace-lib.js';
import { ILogOutput } from './interfaces/logger.js';
import { Timer } from './Timer.js';

export default async function runWithOptions(runOptions: TRunOptions) {
	const { trace, startRunCallback, endFeatureCallback, featureFilter, specl, bases, protoOptions } = runOptions;
	const { LOG_LEVEL: logLevel, LOG_FOLLOW: logFollow } = protoOptions.options;

	const logger = new Logger({ level: logLevel || 'debug', follow: logFollow });

	const timer = new Timer();
	let totalRan = 0;
	type TFailure = { sequence: TTagValue; runDuration: number; fromStart: number };
	const allFailures: { [message: string]: TFailure[] } = {};
	let allRunResults: PromiseSettledResult<TRunResult>[] = [];

	let groupRuns: Promise<TRunResult>[] = [];
		const runtime = {};
		const tag: TTag = getRunTag(totalRan, 0, trace);
		totalRan++;

		const res = await doInstanceRun(
			bases,
			specl,
			runtime,
			featureFilter,
			new WorldContext(tag ),
			protoOptions,
			logger,
			tag,
			timer,
			startRunCallback,
			endFeatureCallback
		);
		return res;
	});
	groupRuns = groupRuns.concat(instances);

	const theseValues = await Promise.allSettled(groupRuns);
	allRunResults = allRunResults.concat(theseValues);

	const ranResults = allRunResults
		.filter((i) => i.status === 'fulfilled')
		.map((i) => <PromiseFulfilledResult<TRunResult>>i)
		.map((i) => i.value);

	let passed = 0;
	let failed = 0;

	const output = [];
	for (const r of ranResults) {
		output.push(r.output);
		if (r.result.ok) {
			passed++;
		} else {
			try {
				const errorMessage = r.result?.failure?.error?.message || JSON.stringify(r.result.failure);
				allFailures[errorMessage] = (allFailures[errorMessage] || []).concat({
					sequence: r.tag.sequence,
					runDuration: r.runDuration,
					fromStart: r.fromStart,
				});
				failed++;
			} catch (e) {
				console.error('fail message', e, '\nfrom:', r.result.failure, 'bailing');
				throw e;
			}
		}
	}

	const exceptionResults = allRunResults
		.filter((i) => i.status === 'rejected')
		.map((i) => <PromiseRejectedResult>i)
		.map((i) => i.reason);

	const ok = ranResults.every((a) => a.result.ok);
	const runTime = timer.since();
	return { ok, output, exceptionResults, ranResults, allFailures, logger, passed, failed, totalRan, runTime };
}

async function doInstanceRun(
	bases: TBase,
	specl: TSpecl,
	runtime: object,
	featureFilter: string[] | undefined,
	shared: WorldContext,
	protoOptions: TProtoOptions,
	containerLogger: ILogOutput,
	tag: TTag,
	timer: Timer,
	startRunCallback?: TStartRunCallback,
	endFeatureCallback?: TEndFeatureCallback
) {
	const runStart = process.hrtime();
	const logger = new Logger({ output: containerLogger, tag });

	const world: TWorld = {
		options: protoOptions.options,
		extraOptions: protoOptions.extraOptions,
		shared,
		logger,
		runtime,
		tag,
		timer,
		bases,
	};
	if (startRunCallback) {
		startRunCallback(world);
	}

	const runResult = await run({ specl, bases, world, featureFilter, endFeatureCallback });
	const output = await getOutputResult(world.options.OUTPUT, runResult);

	return {
		result: runResult,
		shared,
		output,
		tag,
		runStart: runStart[0],
		runDuration: process.hrtime(runStart)[0],
		fromStart: timer.since(),
	};
}

*/