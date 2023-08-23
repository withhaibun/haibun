#!/usr/bin/env node

import sourceMapSupport from 'source-map-support';
import repl from 'repl';
import { TSpecl, TWorld, TEndFeatureCallback, TEndFeatureCallbackParams, TRunOptions, TBase, STAY_ALWAYS, STAY } from '@haibun/core/build/lib/defs.js';
import { EMediaTypes, ITrackResults } from '@haibun/domain-storage/build/domain-storage.js';

import { findStepper, getConfigFromBase, getDefaultOptions, basesFrom } from '@haibun/core/build/lib/util/index.js';
import runWithOptions from '@haibun/core/build/lib/run-with-options.js';
import { processArgs, processBaseEnvToOptionsAndErrors, usageThenExit } from './lib.js';
import { Timer } from '@haibun/core/build/lib/Timer.js';
import { existsSync, renameSync, writeFileSync } from 'fs';

sourceMapSupport.install();

process.on('unhandledRejection', console.error);

go().catch(console.error);

async function go() {
  const { params, configLoc, showHelp } = processArgs(process.argv.slice(2));
  const featureFilter = params[1] ? params[1].split(',') : undefined;
  const bases = basesFrom(params[0]?.replace(/\/$/, ''));

  const specl = await getSpeclOrExit(configLoc ? [configLoc] : bases);

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
  const { KEY: keyIn, TRACE: trace, OUTPUT: output, OUTPUT_DEST: outputDest } = protoOptions.options;
  const key = keyIn || Timer.key;
  Timer.key = key;
  const title = protoOptions.options.TITLE || bases + ' ' + [...featureFilter || []].join(',');

  if (outputDest && !output) {
    await usageThenExit(specl, 'OUTPUT_DEST requires OUTPUT');
  }

  let running;
  const startRunCallback = (world: TWorld) => {
    running = (protoOptions.options.CLI) ? repl.start({ prompt: 'repl: ', useColors: true, useGlobal: true }).context.haibun = { world } : undefined;
  }
  let endFeatureCallback: TEndFeatureCallback | undefined = undefined;
  if (trace) {
    endFeatureCallback = async (params: TEndFeatureCallbackParams) => {
      const { world, result, steppers, startOffset } = params;
      const tracker = findStepper<ITrackResults>(steppers, 'OutReviews');
      const loc = { ...world };
      if (running) running.context.haibun.step = { world, result, steppers, startOffset };

      await tracker.writeTracksFile({ ...loc, mediaType: EMediaTypes.json }, title, result, Timer.startTime, startOffset);
    }
  }

  const runOptions: TRunOptions = { key, featureFilter, loops, members, splits, trace, specl, bases, protoOptions, startRunCallback, endFeatureCallback };
  const { ok, exceptionResults, ranResults, allFailures, logger, passed, failed, totalRan, runTime, output: runOutput } = await runWithOptions(runOptions);
  // FIXME
  if (runOutput) {
    if (outputDest) {
      runOutput.map((a, i) => {
        if (a) {
          writeFileSync(outputDest.toString().replace('/', `/${i}-`), a);
        }
      });
    } else {
      // logger.log(JSON.stringify(runOutput, null, 2));
    }
  }

  if (ok && exceptionResults.length < 1) {
    logger.log('OK ' + ranResults.every((r) => r.output));
  } else {
    logger.error('failures:' + JSON.stringify({ results: ranResults[0].result.featureResults || allFailures }, null, 2));
    if (existsSync('failures.json')) {
      renameSync('failures.json', 'failures-previous.json');
    }
    writeFileSync('failures.json', JSON.stringify({ results: ranResults[0].result.featureResults || allFailures }, null, 2));
    logger.info('errors were written to failures.json');
  }
  logger.info(`\nRESULT>>> ${JSON.stringify({ ok, startDate: Timer.startTime, key: Timer.key, passed, failed, totalRan, runTime, 'features/s:': totalRan / runTime })}`);

  if (ok && exceptionResults.length < 1) {
    if (protoOptions.options[STAY] !== STAY_ALWAYS) {
      process.exit(0);
    }
  } else if (!protoOptions.options[STAY]) {
    process.exit(1);
  }
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
