#!/usr/bin/env node

import sourceMapSupport from 'source-map-support';

import {
	TSpecl,
	TEndFeatureCallback,
	TEndFeatureCallbackParams,
	TBase,
	STAY_ALWAYS,
	STAY,
	TWorld,
	TProtoOptions,
} from '@haibun/core/build/lib/defs.js';
import { IHandleResultHistory, HANDLE_RESULT_HISTORY } from '@haibun/domain-storage/build/domain-storage.js';

import { findHandlers, getDefaultOptions, basesFrom } from '@haibun/core/build/lib/util/index.js';
import { getConfigFromBase, processArgs, processBaseEnvToOptionsAndErrors, usageThenExit } from './lib.js';
import { Timer } from '@haibun/core/build/lib/Timer.js';
import Logger from '@haibun/core/build/lib/Logger.js';
import { EMediaTypes } from '@haibun/domain-storage/build/media-types.js';
import { Runner } from '@haibun/core/build/runner.js';
import { WorldContext } from '@haibun/core/build/lib/contexts.js';
import { getDefaultTag } from '@haibun/core/build/lib/test/lib.js';

sourceMapSupport.install();

process.on('unhandledRejection', console.error);

go().catch(console.error);

async function go() {
	const { params, configLoc, showHelp } = processArgs(process.argv.slice(2));
	const bases = basesFrom(params[0]?.replace(/\/$/, ''));
	const specl = await getSpeclOrExit(configLoc ? [configLoc] : bases);

	if (showHelp) {
		await usageThenExit(specl);
	}
	const featureFilter = params[1] ? params[1].split(',') : undefined;

	const { protoOptions, errors } = processBaseEnvToOptionsAndErrors(process.env, specl.options);
	if (errors.length > 0) {
		await usageThenExit(specl, errors.join('\n'));
	}

	const { TRACE: trace, OUTPUT: output, OUTPUT_DEST: outputDest } = protoOptions.options;
	if (outputDest && !output) {
		await usageThenExit(specl, 'OUTPUT_DEST requires OUTPUT');
	}

	const description = protoOptions.options.DESCRIPTION || bases + ' ' + [...(featureFilter || [])].join(',');
	const world = getWorld(protoOptions, bases);

	let endFeatureCallback: TEndFeatureCallback | undefined = undefined;
	if (trace) {
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
	const result = await runner.run(specl.steppers);
	console.log('🤑', JSON.stringify(result, null, 2));

	if (result.ok) {
		if (protoOptions.options[STAY] !== STAY_ALWAYS) {
			process.exit(0);
		}
	} else if (!protoOptions.options[STAY]) {
		process.exit(1);
	}
}

function getWorld(protoOptions: TProtoOptions, bases: TBase): TWorld {
	const { KEY: keyIn, LOG_LEVEL: logLevel, LOG_FOLLOW: logFollow } = protoOptions.options;
	const tag = getDefaultTag(0);
	const logger = new Logger({ level: logLevel || 'debug', follow: logFollow });
	const shared = new WorldContext(tag);
	const timer = new Timer();

	const key = keyIn || Timer.key;
	Timer.key = key;

	const world: TWorld = {
		tag,
		shared,
		runtime: {},
		logger,
		...protoOptions,
		timer,
		bases,
	};
	return world;
}

async function getSpeclOrExit(bases: TBase): Promise<TSpecl> {
	const specl = getConfigFromBase(bases);
	if (specl === null || bases?.length < 1) {
		if (specl === null) {
			console.error(`missing or unusable config.json from ${bases}`);
		}
		await usageThenExit(specl ? specl : getDefaultOptions());
	}
	return specl;
}
