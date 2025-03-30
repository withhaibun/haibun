#!/usr/bin/env node

import sourceMapSupport from 'source-map-support';

import { TSpecl, TBase, STAY_ALWAYS, STAY, TWorld, TProtoOptions, CHECK_NO, CHECK_YES, isProcessFeatureResults } from '@haibun/core/build/lib/defs.js';

import { getDefaultOptions, basesFrom } from '@haibun/core/build/lib/util/index.js';
import { getAllSteppers, getConfigFromBase, processArgs, processBaseEnvToOptionsAndErrors, usageThenExit } from './lib.js';
import { Timer } from '@haibun/core/build/lib/Timer.js';
import Logger from '@haibun/core/build/lib/Logger.js';
import { Runner } from '@haibun/core/build/runner.js';
import { WorldContext } from '@haibun/core/build/lib/contexts.js';
import { getDefaultTag } from '@haibun/core/build/lib/test/lib.js';

sourceMapSupport.install();

process.on('unhandledRejection', console.error);

go().catch(console.error);

async function go() {
	const { params, configLoc, showHelp, showSteppers } = processArgs(process.argv.slice(2));
	const bases = basesFrom(params[0]?.replace(/\/$/, ''));
	const specl = await getSpeclOrExit(configLoc ? [configLoc] : bases);

	if (showHelp) {
		await usageThenExit(specl);
	}
	if (showSteppers) {
		const allSteppers = await getAllSteppers(specl);
		console.info('Steppers:', JSON.stringify(allSteppers, null, 2));
		process.exit(0);
	}
	const featureFilter = params[1] ? params[1].split(',') : undefined;

	const { protoOptions, errors } = processBaseEnvToOptionsAndErrors(process.env, specl.options);
	if (errors.length > 0) {
		await usageThenExit(specl, errors.join('\n'));
	}

	const description = protoOptions.options.DESCRIPTION || bases + ' ' + [...(featureFilter || [])].join(',');
	const world = getWorld(protoOptions, bases);

	const runner = new Runner(world);

	console.info('\n_________________________________ start');
	const executorResult = await runner.run(specl.steppers, featureFilter);
	console.info(executorResult.ok ? CHECK_YES : CHECK_NO, 'At', JSON.stringify(executorResult.failure) /*result.failure.stage, '\n', result.failure.error.message*/);

	for (const maybeResultProcessor of executorResult.steppers) {
		if (isProcessFeatureResults(maybeResultProcessor)) {
			await maybeResultProcessor.processFeatureResult(executorResult);
		}
	}

	if (executorResult.ok) {
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
