#!/usr/bin/env node

import sourceMapSupport from 'source-map-support';
import repl from 'repl';
import { TSpecl, TWorld, TEndFeatureCallback, TEndFeatureCallbackParams, TRunOptions, TBase } from '@haibun/core/build/lib/defs.js';
import { EMediaTypes, ITrackResults } from '@haibun/domain-storage/build/domain-storage.js';

import { findStepper, getConfigFromBase, getDefaultOptions, basesFrom } from '@haibun/core/build/lib/util/index.js';
import runWithOptions from '@haibun/core/build/lib/run-with-options.js';
import { processArgs, processBaseEnvToOptionsAndErrors, usageThenExit } from './lib.js';
import { Timer } from '@haibun/core/build/lib/Timer.js';

sourceMapSupport.install();

process.on('unhandledRejection', console.error);

go();

async function go() {
  const { params, configLoc, showHelp } = processArgs(process.argv.slice(2));
  const featureFilter = params[1] ? params[1].split(',') : undefined;
  const bases = basesFrom(params[0]?.replace(/\/$/, ''));

  const specl = getSpeclOrExit(configLoc ? [configLoc] : bases);

  if (showHelp) {
    await usageThenExit(specl);
  }

  const { protoOptions, errors } = processBaseEnvToOptionsAndErrors(process.env, specl.options);

  if (errors.length > 0) {
    await usageThenExit(specl, errors.join('\n'));
  }

  const splits: { [name: string]: string }[] = protoOptions.options.SPLITS || [{}];
  console.info('\n_________________________________ start');

  const loops = protoOptions.options.LOOPS || 1;
  const members = protoOptions.options.MEMBERS || 1;
  const trace = protoOptions.options.TRACE;
  const title = protoOptions.options.TITLE || bases + ' ' + [...featureFilter || []].join(',');

  const startRunCallback = (world: TWorld) => {
    if (protoOptions.options.CLI) repl.start().context.runtime = world.runtime;
  }
  let endFeatureCallback: TEndFeatureCallback | undefined = undefined;
  if (trace) {
    endFeatureCallback = async (params: TEndFeatureCallbackParams) => {
      const { world, result, steppers, startOffset } = params;
      const tracker = findStepper<ITrackResults>(steppers, 'OutReviews');
      const loc = { ...world };

      await tracker.writeTracksFile({ ...loc, mediaType: EMediaTypes.json }, title, result, Timer.startTime, startOffset);
    }
  }

  const runOptions: TRunOptions = { featureFilter, loops, members, splits, trace, specl, bases, protoOptions, startRunCallback, endFeatureCallback };
  const { ok, exceptionResults, ranResults, allFailures, logger, passed, failed, totalRan, runTime } = await runWithOptions(runOptions);

  if (ok && exceptionResults.length < 1) {
    logger.log('OK ' + ranResults.every((r) => r.output));
  } else {
    logger.error('failures:' + JSON.stringify(allFailures, null, 2));
  }
  console.info('\nRESULT>>>', { ok, startDate: Timer.startTime, startTime: Timer.startTime, passed, failed, totalRan, runTime, 'features/s:': totalRan / runTime });

  if (ok && exceptionResults.length < 1 && protoOptions.options.STAY !== 'always') {
    process.exit(0);
  } else if (protoOptions.options.STAY !== 'always') {
    process.exit(1);
  }
}

function getSpeclOrExit(bases: TBase): TSpecl {
  const specl  = getConfigFromBase(bases);
  if (specl === null || bases?.length < 1) {
    if (specl === null) {
      console.error(`missing or unusable config.json from ${bases}`);
    }
    usageThenExit(specl ? specl : getDefaultOptions());
  }
  return specl;
}
