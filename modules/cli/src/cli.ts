#!/usr/bin/env node

import repl from 'repl';
import { AStepper, TResult, ITraceResult, IReviewResult, TSpecl, TWorld, IPublishResults } from '@haibun/core/build/lib/defs';

import { findStepper, getConfigFromBase, getDefaultOptions } from '@haibun/core/build/lib/util';
import runWithOptions from '@haibun/core/build/lib/run-with-options';
import { processBaseEnv, ranResultError, usageThenExit } from './lib';
import { Timer } from '@haibun/core/build/lib/Timer';

type TFeatureFilter = string[] | undefined;

go();

async function go() {
  const featureFilter = !!process.argv[3] ? process.argv[3].split(',') : undefined;
  const base = process.argv[2]?.replace(/\/$/, '');

  const specl = getSpeclOrExit(base, featureFilter);

  const { protoOptions, errors } = processBaseEnv(process.env, specl.options);
  const splits: { [name: string]: string }[] = protoOptions.options.SPLITS || [{}];

  if (errors.length > 0) {
    await usageThenExit(specl, errors.join('\n'));
  }

  console.info('\n_________________________________ start');

  const loops = protoOptions.options.LOOPS || 1;
  const members = protoOptions.options.MEMBERS || 1;
  const trace = protoOptions.options.PUBLISH || protoOptions.options.REVIEWS || protoOptions.options.TRACE;
  const reviews = protoOptions.options.PUBLISH || protoOptions.options.REVIEWS;
  const publish = protoOptions.options.PUBLISH;

  const startRunCallback = (world: TWorld) => {
    if (protoOptions.options.CLI) repl.start().context.runtime = world.runtime;
  }
  const endRunCallback = async (world: TWorld, result: TResult, steppers: AStepper[]) => {
    if (trace) {
      const tracer = findStepper<ITraceResult & IReviewResult & IPublishResults>(steppers, 'OutReviews');
      await tracer.writeTraceFile(world, result);
      if (reviews) {
        await tracer.writeReview(world, result);
      }
      if (publish) {
        await tracer.publishResults(world);
      }
    }
  }

  const runOptions = { featureFilter, loops, members, splits, trace, specl, base, protoOptions, startRunCallback, endRunCallback };
  const { ok, exceptionResults, ranResults, allFailures, logger, passed, failed, totalRan, runTime } = await runWithOptions(runOptions);

  if (ok && exceptionResults.length < 1) {
    logger.log(ranResults.every((r) => r.output));
  } else {
    try {
      console.error(ranResultError(ranResults, exceptionResults));
    } catch (e) {
      console.error(ranResults[0].result.failure);
    }
  }
  console.info('failures:', JSON.stringify(allFailures, null, 2));
  console.info('\nRESULT>>>', { ok, startDate: Timer.startTime, startTime: Timer.startTime.getTime(), passed, failed, totalRan, runTime, 'features/s:': totalRan / runTime });

  if (ok && exceptionResults.length < 1 && protoOptions.options.STAY !== 'always') {
    process.exit(0);
  } else if (protoOptions.options.STAY !== 'always') {
    process.exit(1);
  }
}

function getSpeclOrExit(base: string, featureFilter: TFeatureFilter): TSpecl {
  const specl = getConfigFromBase(base);

  if (specl === null || !process.argv[2] || featureFilter?.find(f => f === '--help' || f === '-h')) {
    usageThenExit(specl ? specl : getDefaultOptions());
  }
  return specl!;
}

