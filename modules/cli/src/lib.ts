import nodeFS from 'fs';

import { BASE_PREFIX, DEFAULT_DEST, IHasOptions, TBase, TProtoOptions, TSpecl } from '@haibun/core/build/lib/defs.js';
import { getCreateSteppers } from '@haibun/core/build/lib/test/lib.js';
import { getPre } from '@haibun/core/build/lib/util/index.js';
import { BaseOptions } from './BaseOptions.js';
import { TFileSystem } from '@haibun/core/build/lib/util/workspace-lib.js';

const OPTION_CONFIG = '--config';
const OPTION_HELP = '--help';
const OPTION_SHOW_STEPPERS = '--show-steppers';

type TEnv = { [name: string]: string | undefined };

export async function usageThenExit(specl: TSpecl, message?: string) {
	const output = await usage(specl, message);
	console[message ? 'error' : 'info'](output);
	process.exit(message ? 1 : 0);
}

export async function getAllSteppers(specl: TSpecl) {
	const steppers = await getCreateSteppers(specl.steppers);
	const a = steppers.reduce((acc, o) => {
		return {
			...acc,
			[(o as any).constructor.name]: Object.entries(o.steps).map(
				([stepperName, stepperMatch]) => stepperName + ': ' + (stepperMatch.gwta || stepperMatch.match || stepperMatch.match)
			),
		};
	}, {} as { [name: string]: { desc: string } });
	return a;
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
		`usage: ${process.argv[1]} [${OPTION_CONFIG} path/to/specific/config.json] [${OPTION_HELP}] [${OPTION_SHOW_STEPPERS}] <project base[,project base]> <[filter,filter]>`,
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
				if (res.error) {
					errors.push(res.error);
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
	protoOptions.options.env = nenv;

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
