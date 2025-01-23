import nodeFS from 'fs';

import { BASE_PREFIX, DEFAULT_DEST, IHasOptions, TBase, TOptions, TProtoOptions, TSpecl, TWorld, } from "@haibun/core/build/lib/defs.js";
import { getCreateSteppers, getDefaultTag } from "@haibun/core/build/lib/test/lib.js";
import { getDefaultOptions, getPre } from "@haibun/core/build/lib/util/index.js";
import { BaseOptions } from "./BaseOptions.js";
import { TFileSystem } from "@haibun/core/build/lib/util/workspace-lib.js";
import { WorldContext } from '@haibun/core/build/lib/contexts.js';
import Logger from '@haibun/core/build/lib/Logger.js';
import { Timer } from '@haibun/core/build/lib/Timer.js';

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

export function processBaseEnvToOptionsAndErrors(env: TEnv, options: TOptions) {
  const protoOptions: TProtoOptions = { options: { ...options }, moduleOptions: {} };

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
          errors.push(`no base option for ${opt} from ${JSON.stringify(res.result)}`);
        } else {
          protoOptions.options[opt] = res.result;
        }
      } else if (k.startsWith(`${BASE_PREFIX}O_`)) {
        protoOptions.moduleOptions[k] = value;
      } else {
        errors.push(`no found option for ${opt}`);
      }
    });
  protoOptions.options.env = nenv;

  return { protoOptions, errors };
}

export function processArgs(args: string[]) {
  let showHelp = false;
  let showVersion = false;
  const params = [];
  let configLoc;
  while (args.length > 0) {
    const cur = args.shift();

    if (cur === '--config' || cur === '-c') {
      configLoc = args.shift()?.replace(/\/config.json$/, '');
    } else if (cur === '--help' || cur === '-h') {
      showHelp = true;
    } else if (cur === '--version' || cur === '-v') {
      showVersion = true;
    } else {
      params.push(cur);
    }
  }
  return { params, configLoc, showHelp, showVersion };
}

export function getConfigFromBase(bases: TBase, fs: TFileSystem = nodeFS): TSpecl | null {
	const found = bases?.filter((b) => fs.existsSync(`${b}/config.json`));
	if (found.length > 1) {
		console.error(`Found multiple config.json files: ${found.join(', ')}. Use --config to specify one.`);
		return null;
	}
	const configDir = found[0] || '.';
	const f = `${configDir}/config.json`;
	console.info(`trying ${f}`);
	try {
		const specl = JSON.parse(fs.readFileSync(f, 'utf-8'));
		if (!specl.options) {
			specl.options = { DEST: DEFAULT_DEST };
		}
		return specl;
	} catch (e) {
		return null;
	}
}

export function getCliWorld(protoOptions: TProtoOptions, bases: TBase): TWorld {
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

export async function getSpeclOrExit(bases: TBase): Promise<TSpecl> {
	const specl = getConfigFromBase(bases);
	if (specl === null || bases?.length < 1) {
		if (specl === null) {
			console.error(`missing or unusable config.json from ${bases}`);
		}
		await usageThenExit(specl ? specl : getDefaultOptions());
	}
	return specl;
}