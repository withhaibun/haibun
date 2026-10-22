/**
 * The conditions a supervisor's run starts under, read as the run reads them: from its directory's configuration and the
 * environment, with the .env file of its starting directory where the configuration declares an environment. They give the
 * outcome its actualities file records against its present dependencies, and the sign-in its web server requires.
 */
import path from "node:path";
import { parseEnv } from "node:util";
import { BASIC_AUTH_OPTION, basicAuthUsers, type TBasicAuthUser } from "@haibun/core/lib/domains/basic-auth.js";
import { processBaseEnvToOptionsAndErrors } from "../domains/base-options.js";
import type { TSpecl } from "@haibun/core/lib/actuality.js";
import type { TGroupEnded } from "../adapters/actualities.js";
import type { TSupervisorPorts } from "../ports.js";
import { DOTENV, getConfigFromBase, readsDotenv } from "./specl.js";

/** Returns the environment of a run of `specl` started in `cwd`. A variable in `env` takes precedence over the same name in the
 *  .env file in `cwd`, which is read only where `specl` declares an environment. A run reads its own .env file the same way. */
function environmentIn({ fs }: TSupervisorPorts, cwd: string, env: NodeJS.ProcessEnv, specl: TSpecl): NodeJS.ProcessEnv {
	const dotenv = path.join(cwd, DOTENV);
	if (!readsDotenv(specl) || !fs.existsSync(dotenv)) return env;
	return { ...parseEnv(String(fs.readFileSync(dotenv, "utf-8"))), ...env };
}

/** Returns the recorded outcome of a run's features against their present state, under the conditions a run would receive.
 *  It computes those conditions as a run does: from `cwd`, with the environment a run reads there.
 *  Returns undefined when the features haven't executed against that state, and throws where the configuration doesn't read.
 *  startRun forks the child where it returns undefined. */
export function verifiedRun(ports: TSupervisorPorts, config: string, bases: string[], filter: string, cwd: string, env: NodeJS.ProcessEnv): TGroupEnded | undefined {
	const specl = getConfigFromBase(bases, ports.fs);
	const { options, moduleOptions } = processBaseEnvToOptionsAndErrors(environmentIn(ports, cwd, env, specl), specl);
	const v = ports.actualities.verificationOf({ configPath: config, specl, bases, cwd, filter: filter ? filter.split(",") : [], options, moduleOptions });
	return v === undefined ? undefined : ports.actualities.outcomeAgainst(v);
}

/** Returns the first user that the BASIC_AUTH option lists for the web server of a run of `bases`, or undefined when the option is unset.
 *  It reads the option as a run does: from `env`, the .env file in `cwd`, and the config. */
export function signInOf(ports: TSupervisorPorts, bases: string[], cwd: string, env: NodeJS.ProcessEnv): TBasicAuthUser | undefined {
	const specl = getConfigFromBase(bases, ports.fs);
	const listed = processBaseEnvToOptionsAndErrors(environmentIn(ports, cwd, env, specl), specl).moduleOptions[BASIC_AUTH_OPTION];
	return listed ? basicAuthUsers(String(listed))[0] : undefined;
}
