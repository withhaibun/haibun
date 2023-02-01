#!/usr/bin/env node

import sourceMapSupport from 'source-map-support';

sourceMapSupport.install();

process.on('unhandledRejection', console.error);

import repl from 'repl';
import { TSpecl, TWorld, TEndFeatureCallback, TEndFeatureCallbackParams, TRunOptions } from '@haibun/core/build/lib/defs.js';
import { EMediaTypes, ITrackResults } from '@haibun/domain-storage/build/domain-storage.js';

import { findStepper, getConfigFromBase, getDefaultOptions } from '@haibun/core/build/lib/util/index.js';
import runWithOptions from '@haibun/core/build/lib/run-with-options.js';
import { processBaseEnvToOptionsAndErrors, usageThenExit } from './lib.js';
import { Timer } from '@haibun/core/build/lib/Timer.js';

type TFeatureFilter = string[] | undefined;

go();

async function go() {
  const featureFilter = process.argv[3] ? process.argv[3].split(',') : undefined;
  const base = process.argv[2]?.replace(/\/$/, '');

  const specl = getSpeclOrExit(base, featureFilter);

  const { protoOptions, errors } = processBaseEnvToOptionsAndErrors(process.env, specl.options);
  const splits: { [name: string]: string }[] = protoOptions.options.SPLITS || [{}];

  if (errors.length > 0) {
    await usageThenExit(specl, errors.join('\n'));
  }

  console.info('\n_________________________________ start');

  const loops = protoOptions.options.LOOPS || 1;
  const members = protoOptions.options.MEMBERS || 1;
  const trace = protoOptions.options.TRACE;
  const title = protoOptions.options.TITLE || base + ' ' + [...featureFilter || []].join(',');

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

  const runOptions: TRunOptions = { featureFilter, loops, members, splits, trace, specl, base, protoOptions, startRunCallback, endFeatureCallback };
  const { ok, exceptionResults, ranResults, allFailures, logger, passed, failed, totalRan, runTime } = await runWithOptions(runOptions);

  if (ok && exceptionResults.length < 1) {
    logger.log(ranResults.every((r) => r.output));
  } else {
    console.info('failures:', JSON.stringify(allFailures, null, 2));
  }
  console.info('\nRESULT>>>', { ok, startDate: Timer.startTime, startTime: Timer.startTime, passed, failed, totalRan, runTime, 'features/s:': totalRan / runTime });

  if (ok && exceptionResults.length < 1 && protoOptions.options.STAY !== 'always') {
    process.exit(0);
  } else if (protoOptions.options.STAY !== 'always') {
    process.exit(1);
  }
}

function getSpeclOrExit(base: string, featureFilter: TFeatureFilter): TSpecl {
  const specl = getConfigFromBase(base);
  const askForHelp = featureFilter?.find(f => f === '--help' || f === '-h')
  if (specl === null || !base || askForHelp) {
    if (specl === null) {
      console.error(`missing or unusable ${base}/config.json`);
    }
    usageThenExit(specl ? specl : getDefaultOptions());
  }
  return specl;
}

