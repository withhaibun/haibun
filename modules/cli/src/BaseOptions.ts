import type { TEnvVariables } from "@haibun/core/lib/world.js";
import { CONTINUE_AFTER_ERROR, ONCE, SHOWN_LOG_LEVELS, STAY_ALWAYS, STAY_FAILURE, STEP_DELAY } from "@haibun/core/lib/domains/protocol.js";
import { IHasOptions } from "@haibun/core/lib/astepper.js";
import { boolOrError, intOrError, optionOrError, stringOrError } from "@haibun/core/lib/domains/util.js";

export class BaseOptions implements IHasOptions {
	static options = {
		KEY: { desc: "execution key (defaults to serialtime)", parse: (input: string) => stringOrError(input) },
		DESCRIPTION: { desc: "description for reports", parse: (result: string) => ({ result }) },
		SETTING: { desc: "execution setting (eg dev, prod)", parse: (result: string) => ({ result }) },
		STAY: { desc: `stay running after execution: ${STAY_ALWAYS}, ${STAY_FAILURE}`, parse: (result: string) => optionOrError(result, [STAY_ALWAYS, STAY_FAILURE]) },
		[ONCE]: {
			desc: "run a group only when one of its dependencies changed since it last passed. This option applies --once to every run that a script chains",
			parse: (input: string) => boolOrError(input),
		},
		NDJSON: {
			desc: "write actuality's events as NDJSON on stdout for a calling process to read. A loaded monitor stepper doesn't suppress them while this option is set",
			parse: (input: string) => boolOrError(input),
		},
		[CONTINUE_AFTER_ERROR]: { desc: `continue after error`, parse: (input: string) => boolOrError(input) },
		LOG_FOLLOW: { desc: "filter for output", parse: (result: string) => ({ result }) },
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
		HOST_ID: { desc: "integer id of this haibun instance. It prefixes every seqPath, so two hosts' seqPaths don't collide", parse: (input: string) => intOrError(input) },
		PWDEBUG: {
			desc: "(web) enable Playwright debugging with true or 1",
			parse: (input: string) => {
				if (["true", "1"].includes(input)) {
					process.env["PWDEBUG"] = "true";
				}
				return { result: input };
			},
		},
	};
}
