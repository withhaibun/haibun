import { HAIBUN, IHasOptions, TOptions, TProtoOptions, TSpecl, } from "@haibun/core/build/lib/defs";
import { getDefaultWorld } from "@haibun/core/build/lib/test/lib";
import { getSteppers, getPre } from "@haibun/core/build/lib/util";
import { BaseOptions } from "./BaseOptions";
import { TRunResult } from "./cli";

type TEnv = { [name: string]: string | undefined };

export async function usageThenExit(specl: TSpecl, message?: string) {
  const output = await usage(specl, message);
  console[message ? 'error' : 'info'](output);
  process.exit(message ? 1 : 0);
};

export async function usage(specl: TSpecl, message?: string) {
  let steppers = await getSteppers({ steppers: specl.steppers, world: getDefaultWorld(0).world });
  let a: { [name: string]: { desc: string } } = {};
  steppers.forEach(s => {
    const o = (s as IHasOptions);
    if (o.options) {
      const p = getPre(s);
      a = { ...a, ...Object.keys(o.options).reduce((a, i) => ({ ...a, [`${p}${i}`]: o.options![i] }), {}) };
    }
  });

  const ret = [
    '',
    `usage: ${process.argv[1]} <project base>`,
    message || '',
    'Set these environmental variables to control options:\n',
    ...Object.entries(BaseOptions.options).map(([k, v]) => `${HAIBUN}_${k.padEnd(55)} ${v.desc}`),
  ];
  if (Object.keys(a).length) {
    ret.push('\nThese variables are available for selected extensions (via config.js)\n',
      ...Object.entries(a).map(([k, v]) => `${k.padEnd(55)} ${v.desc}`));
  }
  return [...ret, ''].join('\n');
}

export function ranResultError(ranResults: TRunResult[], exceptionResults: any[]): any {
  return JSON.stringify(
    {
      ran: ranResults
        .filter((r) => !r.result.ok)
        .map((r) => ({ stage: r.result.failure?.stage, details: r.result.failure?.error.details, results: r.result.results?.find((r) => r.stepResults.find((r) => !r.ok)) })),
      exceptionResults,
    },
    null,
    2
  );
}

export function processBaseEnv(env: TEnv, options: TOptions) {
  const protoOptions: TProtoOptions = { options: { ...options }, extraOptions: {} };
  let errors: string[] = [];
  let nenv = {};
  const pfx = `${HAIBUN}_`;

  const baseOptions = (BaseOptions as IHasOptions);

  Object.entries(env)
    .filter(([k]) => k.startsWith(pfx))
    .map(([k]) => {
      const value = env[k];
      const opt = k.replace(pfx, '');
      const baseOption = baseOptions.options![opt];

      if (baseOption) {
        const res = baseOption.parse(value!, nenv);
        if (res.error) {
          errors.push(res.error);
        } else if (res.env) {
          nenv = { ...nenv, ...res.env };
        } else if (!res.result) {
          throw Error(`no result from ${res}`);
        } else {
          protoOptions.options[opt] = res.result;
        }
      } else {
        protoOptions.extraOptions[k] = value!;
      }
    });
  protoOptions.options.env = nenv;

  return { protoOptions, errors };
}
