#!/usr/bin/env node

import sourceMapSupport from 'source-map-support';
import repl from 'repl';
import { TSpecl, TWorld, TEndFeatureCallback, TEndFeatureCallbackParams, TRunOptions, TBase, STAY_ALWAYS, STAY, TNotOKActionResult, TFeatureResult } from '@haibun/core/build/lib/defs.js';
import { IHandleResultHistory, HANDLE_RESULT_HISTORY } from '@haibun/domain-storage/build/domain-storage.js';

import { findHandlers, getDefaultOptions, basesFrom } from '@haibun/core/build/lib/util/index.js';
import { getConfigFromBase } from '@haibun/core/build/lib/util/workspace-lib.js';
import runWithOptions from '@haibun/core/build/lib/run-with-options.js';
import { processArgs, processBaseEnvToOptionsAndErrors, usageThenExit } from './lib.js';
import { Timer } from '@haibun/core/build/lib/Timer.js';
import { writeFileSync } from 'fs';
import Logger from '@haibun/core/build/lib/Logger.js';
import { EMediaTypes } from '@haibun/domain-storage/build/media-types.js';

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
  const description = protoOptions.options.DESCRIPTION || bases + ' ' + [...(featureFilter || [])].join(',');

  if (outputDest && !output) {
    await usageThenExit(specl, 'OUTPUT_DEST requires OUTPUT');
  }

  let running;
  const startRunCallback = (world: TWorld) => {
    running = protoOptions.options.CLI ? (repl.start({ prompt: 'repl: ', useColors: true, useGlobal: true }).context.haibun = { world }) : undefined;
  };
  let endFeatureCallback: TEndFeatureCallback | undefined = undefined;
  if (trace) {
    endFeatureCallback = async (params: TEndFeatureCallbackParams) => {
      const { world, result, steppers, startOffset } = params;
      const historyHandlers = findHandlers<IHandleResultHistory>(steppers, HANDLE_RESULT_HISTORY);
      const loc = { ...world };
      if (running) running.context.haibun.step = { world, result, steppers, startOffset };
      const traceHistory = [...Logger.traceHistory];
      for (const h of historyHandlers) {
        await h.handle({ ...loc, mediaType: EMediaTypes.json }, description, result, Timer.startTime, startOffset, traceHistory);
      }
      Logger.traceHistory = [];
    };
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
    try {
      const results = summarizeFeatureResults(ranResults[0].result.featureResults) || allFailures;
      logger.error('failures:' + JSON.stringify({ results }, null, 2));
      writeFileSync(`failures.${key}.json`, JSON.stringify({ results: ranResults || allFailures }, null, 2));
      logger.info('errors were written to failures.json');
    } catch (e) {
      console.error(e);
      logger.error('EXCEPTION failures:', e);
    }
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
          ? s.in
          : {
            ok: s.ok,
            in: s.in,
            actionResults: s.actionResults
              // FIXME shouldn't need cast
              .map((a) => (a.ok ? a.name : { ok: a.ok, name: a.name, message: (a as TNotOKActionResult)?.message, topics: a.topics && Object.keys(a.topics).join(',') })),
          }
      ),
  }));
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
