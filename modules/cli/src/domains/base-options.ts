import { BaseOptionsSchema, type TEnvVariables, type TModuleOptions, type TProtoOptions } from "@haibun/core/lib/world.js";
import type { TSpecl } from "@haibun/core/lib/actuality.js";
import { parseRunPolicyOption, RUN_POLICY } from "@haibun/core/run-policy/domains/run-policy.js";
import {
	BASE_PREFIX,
	CONTINUE_AFTER_ERROR,
	DEFAULT_DEST,
	MODULE_OPTION_PREFIX,
	ONCE,
	SHOWN_LOG_LEVELS,
	STAY_ALWAYS,
	STAY_FAILURE,
	STEP_DELAY,
} from "@haibun/core/lib/domains/protocol.js";
import type { IHasOptions } from "@haibun/core/lib/astepper.js";
import { boolOrError, errorDetail, intOrError, optionOrError, stringOrError } from "@haibun/core/lib/domains/util.js";

export class BaseOptions implements IHasOptions {
	static options = {
		KEY: { desc: "actuality key (defaults to serialtime)", parse: (input: string) => stringOrError(input) },
		STAY: { desc: `stay running after actuality's features end: ${STAY_ALWAYS}, ${STAY_FAILURE}`, parse: (result: string) => optionOrError(result, [STAY_ALWAYS, STAY_FAILURE]) },
		[ONCE]: {
			desc: "run a group only when one of its dependencies changed since it last passed, apart from a run that stays to serve. This option applies --once to every run that inherits it",
			parse: (input: string) => boolOrError(input),
		},
		NDJSON: {
			desc: "write actuality's events as NDJSON on stdout for a calling process to read. A loaded monitor stepper doesn't suppress them while this option is set",
			parse: (input: string) => boolOrError(input),
		},
		[CONTINUE_AFTER_ERROR]: { desc: `continue after error`, parse: (input: string) => boolOrError(input) },
		LOG_LEVEL: { desc: SHOWN_LOG_LEVELS.join(", "), parse: (result: string) => optionOrError(result, [...SHOWN_LOG_LEVELS]) },
		ENV: {
			desc: "pass variables: var=value[,var2=value]",
			parse: (input: string, cur: TEnvVariables) => {
				const pairs = input?.split(",");
				const env: TEnvVariables = { ...cur };
				for (const pair of pairs) {
					const [k, v] = pair.split("=").map((i) => i.trim());
					if (!k && !v) continue;
					if (!k) throw Error(`ENV value ${v} doesn't have a key: write key=${v}`);
					if (v === undefined) return { parseError: `ENV ${k} doesn't have a value: write ${k}=value` };
					if (cur[k] || env[k]) return { parseError: `ENV ${k} is already defined: define each variable once` };
					env[k] = v;
				}
				return { env };
			},
		},
		[STEP_DELAY]: { desc: "delay between steps", parse: (input: string) => intOrError(input) },
		[RUN_POLICY]: {
			desc: 'a run policy: "place dir:access[,dir:access]", which --run-policy states for one run',
			parse: (input: string) => {
				try {
					parseRunPolicyOption(input);
					return { result: input };
				} catch (e) {
					return { parseError: errorDetail(e) };
				}
			},
		},
		HOST_ID: { desc: "integer id of this haibun instance. It prefixes every seqPath, so two hosts' seqPaths don't collide", parse: (input: string) => intOrError(input) },
		HOST_PROJECT_DIR: {
			desc: "the directory where a recording's container mounts the project, from which a run writes the paths it reports",
			parse: (input: string) => stringOrError(input),
		},
	};
}

export type TEnv = { [name: string]: string | undefined };

/** Returns a run's options. A base option takes its default unless the config's options state it, and the environment states it over
 *  either. A module option takes the base config's value unless an environment variable sets it. Throws where a value doesn't parse
 *  or doesn't name an option. */
export function processBaseEnvToOptionsAndErrors(env: TEnv, specl: TSpecl): TProtoOptions {
	const options: Record<string, unknown> = { DEST: DEFAULT_DEST };
	const moduleOptions: TModuleOptions = { ...specl.moduleOptions };

	const errors: string[] = [];
	let nenv = {};

	const baseOptions = (BaseOptions as IHasOptions).options ?? {};
	for (const [k, v] of Object.entries(baseOptions)) if (v.default !== undefined) options[k] = v.default;

	const stated: Record<string, string> = { ...specl.options };
	for (const [k, value] of Object.entries(env)) {
		if (value === undefined || !k.startsWith(BASE_PREFIX)) continue;
		if (k.startsWith(MODULE_OPTION_PREFIX)) moduleOptions[k] = value;
		else stated[k.replace(BASE_PREFIX, "")] = value;
	}
	for (const [opt, value] of Object.entries(stated)) {
		const baseOption = baseOptions[opt];
		if (baseOption === undefined) {
			errors.push(`${opt} isn't an option`);
			continue;
		}
		const res = baseOption.parse(value, nenv);
		if (res.parseError) {
			errors.push(res.parseError);
		} else if (res.env) {
			nenv = { ...nenv, ...res.env };
		} else if (res.result === undefined) {
			errors.push(`option ${opt} doesn't accept ${JSON.stringify(value)}`);
		} else {
			options[opt] = res.result;
		}
	}
	options.envVariables = nenv;

	if (errors.length > 0) {
		throw new Error(errors.join("\n"));
	}

	return { options: BaseOptionsSchema.parse(options), moduleOptions };
}
