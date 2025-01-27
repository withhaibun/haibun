import { currentVersion } from '@haibun/core/build/currentVersion.js';
import {
	CHECK_NOT_OK,
	CHECK_OK,
	STAY,
	STAY_ALWAYS,
	TEndFeatureCallback,
	TEndFeatureCallbackParams,
	TFeatureResult,
} from '@haibun/core/build/lib/defs.js';
import Logger from '@haibun/core/build/lib/Logger.js';
import { Timer } from '@haibun/core/build/lib/Timer.js';
import { basesFrom, findHandlers } from '@haibun/core/build/lib/util/index.js';
import { getOutputResult } from '@haibun/core/build/lib/util/workspace-lib.js';
import { Runner } from '@haibun/core/build/runner.js';
import { HANDLE_RESULT_HISTORY, IHandleResultHistory } from '@haibun/domain-storage/build/domain-storage.js';
import { EMediaTypes } from '@haibun/domain-storage/build/media-types.js';
import { getCliWorld, getSpeclOrExit, processArgs, processBaseEnvToOptionsAndErrors, usageThenExit } from './lib.js';
import TraceLogger from './TraceLogger.js';

export async function runWith({ argv, env }: { argv: string[]; env: NodeJS.ProcessEnv }): Promise<void> {
	const { params, configLoc, showHelp, showVersion } = processArgs(argv.slice(2));
	const bases = basesFrom(params[0]?.replace(/\/$/, ''));
	const specl = await getSpeclOrExit(configLoc ? [configLoc] : bases);

	if (showHelp) {
		await usageThenExit(specl);
	}
	if (showVersion) {
		console.info(`current version ${currentVersion}`);
		process.exit(0);
	}

	const featureFilter = params[1] ? params[1].split(',') : undefined;

	const { protoOptions, errors } = processBaseEnvToOptionsAndErrors(env, specl.options);
	if (errors.length > 0) {
		await usageThenExit(specl, errors.join('\n'));
	}

	const { TRACE: trace, OUTPUT: output, OUTPUT_DEST: outputDest } = protoOptions.options;
	if (outputDest && !output) {
		await usageThenExit(specl, 'OUTPUT_DEST requires OUTPUT');
	}

	const description = protoOptions.options.DESCRIPTION || bases + ' ' + [...(featureFilter || [])].join(',');
	const world = getCliWorld(protoOptions, bases);

	let endFeatureCallback: TEndFeatureCallback | undefined = undefined;
	if (trace) {
		const traceLogger = new TraceLogger();
		world.logger.addSubscriber(traceLogger);
		endFeatureCallback = async (params: TEndFeatureCallbackParams) => {
			const { world, result, steppers, startOffset } = params;
			const historyHandlers = findHandlers<IHandleResultHistory>(steppers, HANDLE_RESULT_HISTORY);
			const loc = { ...world };
			const traceHistory = [...Logger.traceHistory];
			for (const h of historyHandlers) {
				await h.handle(
					{ ...loc, mediaType: EMediaTypes.json },
					description,
					result,
					Timer.startTime,
					startOffset,
					traceHistory
				);
			}
			Logger.traceHistory = [];
		};
	}

	const runner = new Runner(world, { endFeature: [endFeatureCallback] });

	console.info('\n_________________________________ start');
	const result = await runner.run(specl.steppers, featureFilter);
	if (output) {
		const wtw = await getOutputResult(world.options.OUTPUT, result);
		console.log('🤑', JSON.stringify(wtw, null, 2));
	}

	const printResult = result.ok
		? `${CHECK_OK} OK`
		: `${CHECK_NOT_OK} ` + JSON.stringify(summarizeFeatureResults(result.featureResults), null, 2);
	console.log('RESULT', printResult);

	if (result.ok) {
		if (protoOptions.options[STAY] !== STAY_ALWAYS) {
			process.exit(0);
		}
	} else if (!protoOptions.options[STAY]) {
		process.exit(1);
	}
}

function summarizeFeatureResults(featureResults: TFeatureResult[]) {
	return featureResults?.map((f, n) => ({
		'#': n + 1,
		ok: f.ok,
		path: f.path,
		failure: f.failure,
		stepResults: f.ok
			? undefined
			: f.stepResults.map((s) =>
					s.ok
						? s.line
						: {
								ok: s.ok,
								line: s.line,
								actionResult: {
									name: s.actionResult.name,
									topics: Object.values(s.actionResult.topics).map((t) => t.summary),
								},
						  }
			  ),
	}));
}
