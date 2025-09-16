import nodeFS from 'fs';

import { BASE_PREFIX, CHECK_NO, CHECK_YES, DEFAULT_DEST, STAY, STAY_ALWAYS, TBase, TProtoOptions, TSpecl, TWorld } from '@haibun/core/lib/defs.js';
import { getCreateSteppers } from '@haibun/core/lib/test/lib.js';
import { formattedSteppers, getPre } from '@haibun/core/lib/util/index.js';
import { BaseOptions } from './BaseOptions.js';
import { TFileSystem } from '@haibun/core/lib/util/workspace-lib.js';
import { getDefaultOptions, basesFrom } from '@haibun/core/lib/util/index.js';
import { Timer } from '@haibun/core/lib/Timer.js';
import Logger from '@haibun/core/lib/Logger.js';
import { Runner } from '@haibun/core/runner.js';
import { getDefaultTag } from '@haibun/core/lib/test/lib.js';
import { isProcessFeatureResults, IHasOptions } from '@haibun/core/lib/astepper.js';
import { FeatureVariables } from '@haibun/core/lib/feature-variables.js';
import { Prompter } from '@haibun/core/lib/prompter.js';
import { getCoreDomains } from '@haibun/core/lib/domain-types.js';

const OPTION_CONFIG = '--config';
const OPTION_HELP = '--help';
const OPTION_SHOW_STEPPERS = '--show-steppers';

type TEnv = { [name: string]: string | undefined };

export async function runCli(args: string[], env: NodeJS.ProcessEnv) {
	const { params, configLoc, showHelp, showSteppers } = processArgs(args);
	const bases = basesFrom(params[0]?.replace(/\/$/, ''));
	const specl = await getSpeclOrExit(configLoc ? [configLoc] : bases);

	if (showHelp) {
		await usageThenExit(specl);
	}
	if (showSteppers) {
		const allSteppers = await getAllSteppers(specl);
		console.info('Steppers:', JSON.stringify(allSteppers, null, 2));
		console.info('Use the full text version for steps. {vars} should be enclosed in " for literals, or defined by Set or env commands.\nWrite comments using normal sentence punctuation, ending with [.,!?]. ')
		process.exit(0);
	}
	const featureFilter = params[1] ? params[1].split(',') : undefined;

	const { protoOptions, errors } = processBaseEnvToOptionsAndErrors(env);
	if (errors.length > 0) {
		await usageThenExit(specl, errors.join('\n'));
	}

	// const description = protoOptions.options.DESCRIPTION || bases + ' ' + [...(featureFilter || [])].join(',');
	const world = getCliWorld(protoOptions, bases);

	const runner = new Runner(world);

	console.info('\n_________________________________ start');
	const executorResult = await runner.run(specl.steppers, featureFilter);
	console.info(executorResult.ok ? CHECK_YES : `${CHECK_NO} At ${JSON.stringify(executorResult.failure)}`);

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

function getCliWorld(protoOptions: TProtoOptions, bases: TBase): TWorld {
	const { KEY: keyIn, LOG_LEVEL: logLevel, LOG_FOLLOW: logFollow } = protoOptions.options;
	const tag = getDefaultTag(0);
	const logger = new Logger({ level: logLevel || 'log', follow: logFollow });
	const shared = new FeatureVariables(JSON.stringify(tag));
	const timer = new Timer();

	Timer.key = keyIn || Timer.key;

	const world: Partial<TWorld> = {
		tag,
		shared,
		runtime: {},
		logger,
		prompter: new Prompter(),
		...protoOptions,
		timer,
		bases,
	};
	world.domains = getCoreDomains(world as TWorld)
	return world as TWorld;
}

async function getSpeclOrExit(bases: TBase): Promise<TSpecl> {
	const specl = getConfigFromBase(bases);
	if (specl === null || bases?.length < 1) {
		if (specl === null) {
			await usageThenExit(specl ? specl : getDefaultOptions(), `missing or unusable config.json from ${bases} in ${process.cwd()}`);
		}
		await usageThenExit(specl ? specl : getDefaultOptions(), 'no bases');
	}
	return specl;
}
export async function usageThenExit(specl: TSpecl, message?: string) {
	const output = await usage(specl, message);
	console[message ? 'error' : 'info'](output);
	process.exit(message ? 1 : 0);
}

export async function getAllSteppers(specl: TSpecl) {
	const steppers = await getCreateSteppers(specl.steppers);
	return formattedSteppers(steppers);
}

export async function usage(specl: TSpecl, message?: string) {
	const steppers = await getCreateSteppers(specl.steppers);
	let a: { [name: string]: { desc: string } } = {};
	steppers.forEach((s) => {
		const o = s as IHasOptions;
		if (o.options) {
			const p = getPre(s);
			a = { ...a, ...Object.keys(o.options).reduce((a, i) => ({ ...a, [`${p}${i}`]: o.options[i] }), {}) };
		}
	});

	const ret = [
		'',
		`usage: ${process.argv[1]} [${OPTION_CONFIG} path/to/specific/config.json] [--cwd working_directory] [${OPTION_HELP}] [${OPTION_SHOW_STEPPERS}] <project base[,project base]> <[filter,filter]>`,
		message || '',
		'If config.json is not found in project bases, the root directory will be used.\n',
		'Set these environmental variables to control options:\n',
		...Object.entries(BaseOptions.options).map(([k, v]) => `${BASE_PREFIX}${String(k).padEnd(55)} ${v.desc}`),
	];
	if (Object.keys(a).length) {
		ret.push(
			'\nThese variables are available for extensions selected in config.js\n',
			...Object.entries(a).map(([k, v]) => `${k.padEnd(55)} ${v.desc}`)
		);
	}
	return [...ret, ''].join('\n');
}

export function processBaseEnvToOptionsAndErrors(env: TEnv) {
	const protoOptions: TProtoOptions = { options: { DEST: DEFAULT_DEST }, moduleOptions: {} };

	const errors: string[] = [];
	let nenv = {};

	const baseOptions = BaseOptions as IHasOptions;
	baseOptions.options && Object.entries(baseOptions.options).forEach(([k, v]) => (protoOptions.options[k] = v.default));

	Object.entries(env)
		.filter(([k]) => k.startsWith(BASE_PREFIX))
		.map(([k]) => {
			const value = env[k];
			const opt = k.replace(BASE_PREFIX, '');
			const baseOption = baseOptions.options[opt];

			if (baseOption) {
				const res = baseOption.parse(value, nenv);
				if (res.parseError) {
					errors.push(res.parseError);
				} else if (res.env) {
					nenv = { ...nenv, ...res.env };
				} else if (!res.result) {
					errors.push(`no option for ${opt} from ${JSON.stringify(res.result)}`);
				} else {
					protoOptions.options[opt] = res.result;
				}
			} else if (opt.startsWith(`O_`)) {
				protoOptions.moduleOptions[k] = value;
			} else {
				errors.push(`no option for ${opt}`);
			}
		});
	protoOptions.options.envVariables = nenv;

	return { protoOptions, errors };
}

export function processArgs(args: string[]) {
	let showHelp = false;
	let showSteppers = false;
	const params = [];
	let configLoc;
	while (args.length > 0) {
		const cur = args.shift();

		if (cur === OPTION_CONFIG || cur === '-c') {
			configLoc = args.shift()?.replace(/\/config.json$/, '');
		} else if (cur === '--cwd') {
			process.chdir(args.shift());
		} else if (cur === OPTION_HELP || cur === '-h') {
			showHelp = true;
		} else if (cur === OPTION_SHOW_STEPPERS) {
			showSteppers = true;
		} else {
			params.push(cur);
		}
	}
	return { params, configLoc, showHelp, showSteppers };
}

export function getConfigFromBase(bases: TBase, fs: TFileSystem = nodeFS): TSpecl | null {
	const found = bases?.filter((b) => fs.existsSync(`${b}/config.json`));
	if (found?.length > 1) {
		console.error(`Found multiple config.json files: ${found.join(', ')}. Use --config to specify one.`);
		return null;
	}
	const configDir = (found && found[0]) || '.';
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
