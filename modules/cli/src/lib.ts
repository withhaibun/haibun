import { BASE_PREFIX, IHasOptions, TOptions, TProtoOptions, TRunResult, TSpecl, } from "@haibun/core/build/lib/defs.js";
import { getCreateSteppers } from "@haibun/core/build/lib/test/lib.js";
import { getPre } from "@haibun/core/build/lib/util/index.js";
import { BaseOptions } from "./BaseOptions.js";

type TEnv = { [name: string]: string | undefined };

export async function usageThenExit(specl: TSpecl, message?: string) {
  const output = await usage(specl, message);
  console[message ? 'error' : 'info'](output);
  process.exit(message ? 1 : 0);
}

export async function usage(specl: TSpecl, message?: string) {
  const steppers = await getCreateSteppers(specl.steppers);
  let a: { [name: string]: { desc: string } } = {};
  steppers.forEach(s => {
    const o = (s as IHasOptions);
    if (o.options) {
      const p = getPre(s);
      a = { ...a, ...Object.keys(o.options).reduce((a, i) => ({ ...a, [`${p}${i}`]: o.options[i] }), {}) };
    }
  });

  const ret = [
    '',
    `usage: ${process.argv[1]} [--config path/to/specific/config.json] [--help] <project base[,project base]> <[filter,filter]>`,
    message || '',
    'If config.json is not found in project bases, the root directory will be used.\n',
    'Set these environmental variables to control options:\n',
    ...Object.entries(BaseOptions.options).map(([k, v]) => `${BASE_PREFIX}${k.padEnd(55)} ${v.desc}`),
  ];
  if (Object.keys(a).length) {
    ret.push('\nThese variables are available for extensions selected in config.js\n',
      ...Object.entries(a).map(([k, v]) => `${k.padEnd(55)} ${v.desc}`));
  }
  return [...ret, ''].join('\n');
}

export function ranResultError(ranResults: TRunResult[], exceptionResults: any[]): any {
  return JSON.stringify(
    {
      ran: ranResults
        .filter((r) => !r.result.ok)
        .map((r) => ({ stage: r.result.failure?.stage, details: r.result.failure?.error.details, results: r.result.featureResults?.find((r) => r.stepResults.find((r) => !r.ok)) })),
      exceptionResults,
    },
    null,
    2
  );
}

export function processBaseEnvToOptionsAndErrors(env: TEnv, options: TOptions) {
  const protoOptions: TProtoOptions = { options: { ...options }, extraOptions: {} };

  const errors: string[] = [];
  let nenv = {};

  const baseOptions = (BaseOptions as IHasOptions);
  baseOptions.options && Object.entries(baseOptions.options).forEach(([k, v]) => protoOptions.options[k] = v.default);

  Object.entries(env)
    .filter(([k]) => k.startsWith(BASE_PREFIX))
    .map(([k]) => {
      const value = env[k];
      const opt = k.replace(BASE_PREFIX, '');
      const baseOption = baseOptions.options[opt];

      if (baseOption) {
        const res = baseOption.parse(value, nenv);
        if (res.error) {
          errors.push(res.error);
        } else if (res.env) {
          nenv = { ...nenv, ...res.env };
        } else if (!res.result) {
          errors.push(`no option for ${opt} from ${JSON.stringify(res.result)}`);
        } else {
          protoOptions.options[opt] = res.result;
        }
      } else {
        protoOptions.extraOptions[k] = value;
      }
    });
  protoOptions.options.env = nenv;

  return { protoOptions, errors };
}

export function processArgs(args: string[]) {
  let showHelp = false;
  const params = [];
  let configLoc;
  while (args.length > 0) {
    const cur = args.shift();

    if (cur === '--config' || cur === '-c') {
      configLoc = args.shift()?.replace(/\/config.json$/, '');
    } else if (cur === '--help' || cur === '-h') {
      showHelp = true;
    } else {
      params.push(cur);
    }
  }
  return { params, configLoc, showHelp };
}
