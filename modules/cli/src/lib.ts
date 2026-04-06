import nodeFS from "fs";

import { TBase, TProtoOptions, TSpecl, TWorld, SpeclSchema } from "@haibun/core/lib/defs.js";
import { BASE_PREFIX, CHECK_NO, CHECK_YES, DEFAULT_DEST, STAY, STAY_ALWAYS, Timer, TExecutorResult } from "@haibun/core/schema/protocol.js";
import { IHasOptions } from "@haibun/core/lib/astepper.js";
import { getCreateSteppers, getDefaultTag } from "@haibun/core/lib/test/lib.js";
import { formattedSteppers, getPre, getDefaultOptions, basesFrom, verifyRequiredOptions, verifyExtraOptions } from "@haibun/core/lib/util/index.js";
import { BaseOptions } from "./BaseOptions.js";
import { TFileSystem, getSteppers } from "@haibun/core/lib/util/workspace-lib.js";
import { Runner } from "@haibun/core/runner.js";
import { FeatureVariables } from "@haibun/core/lib/feature-variables.js";
import { Prompter } from "@haibun/core/lib/prompter.js";
import { getCoreDomains } from "@haibun/core/lib/core-domains.js";
import { EventLogger } from "@haibun/core/lib/EventLogger.js";
import { TAnyFixme } from "@haibun/core/lib/fixme.js";
import { OPTION_RUN_POLICY, OPTION_DRY_RUN, HAIBUN_RUN_POLICY, parseRunPolicyArgs, parseRunPolicyEnv, type TRunPolicyConfig } from "@haibun/core/run-policy/run-policy-types.js";
import { loadAndValidateRunPolicy } from "@haibun/core/run-policy/run-policy-schema.js";
import { PhaseRunner, PhaseBailError } from "@haibun/core/lib/PhaseRunner.js";
import { getFeaturesAndBackgrounds, TFeaturesBackgrounds } from "@haibun/core/phases/collector.js";

const OPTION_CONFIG = "--config";
const OPTION_HELP = "--help";
const OPTION_SHOW_STEPPERS = "--show-steppers";
const OPTION_WITH_STEPPERS = "--with-steppers";

type TEnv = { [name: string]: string | undefined };

export async function runCli(args: string[], env: NodeJS.ProcessEnv) {
	const parsed = processArgs(args);
	const bases = basesFrom(parsed.params[0]?.replace(/\/$/, ""));
	const specl = await getSpeclOrExit(parsed.configLoc ? [parsed.configLoc] : bases);

	if (parsed.showHelp) return await usageThenExit(specl);
	if (parsed.showSteppers) return await showSteppersAndExit(specl);

	let world: TWorld | undefined;
	let protoOptions: TProtoOptions | undefined;

	try {
		const pr = new PhaseRunner();
		protoOptions = await pr.tryPhase("processBaseEnvToOptionsAndErrors", () => processBaseEnvToOptionsAndErrors(env));

		world = getCliWorld(protoOptions, bases);
		pr.world = world;
		const policyConfig = resolveRunPolicy(parsed.policyConfig, env, protoOptions, specl);
		const featureFilter = parsed.params[1] ? parsed.params[1].split(",") : undefined;

		const featuresBackgrounds = await pr.tryPhase("Collector", () => getFeaturesAndBackgrounds(bases, featureFilter, policyConfig));

		if (parsed.dryRun) return dryRunExit(featuresBackgrounds, policyConfig, featureFilter); // Exits process

		const csteppers = await pr.tryPhase("Steppers", async () => {
			const s = await getSteppers([...specl.steppers, ...parsed.withSteppers]);
			verifyRequiredOptions(s, world.moduleOptions);
			verifyExtraOptions(world.moduleOptions, s);
			return s;
		});

		const runner = new Runner(world);
		const result = await runner.runFeaturesAndBackgrounds(csteppers, featuresBackgrounds);

		await reportAndExit(result, world, protoOptions);
	} catch (error) {
		// Final Error "Nothing" Branch
		if (error instanceof PhaseBailError) {
			return await reportAndExit(error.result, world, protoOptions);
		}

		const message = PhaseRunner.formatError(error);

		// Vitest mocks process.exit as throwing an error. Let it bubble so tests pass.
		if (message.startsWith("exit with code ")) throw error;

		console.error(`\n${CHECK_NO} ${message}`);
		process.exit(1);
	}
}

async function showSteppersAndExit(specl: TSpecl) {
	const allSteppers = await getAllSteppers(specl);
	console.info("Steppers:", JSON.stringify(allSteppers, null, 2));
	console.info(
		'Use the full text version for steps. {vars} should be enclosed in " for literals, or defined by Set or env commands.\nWrite comments using normal sentence punctuation, ending with [.,!?]. ',
	);
	process.exit(0);
}

export function resolveRunPolicy(cliPolicyConfig: TRunPolicyConfig | undefined, env: NodeJS.ProcessEnv, protoOptions: TProtoOptions, specl: TSpecl): TRunPolicyConfig | undefined {
	let policyConfig = cliPolicyConfig;
	if (!policyConfig && env[HAIBUN_RUN_POLICY]) {
		policyConfig = parseRunPolicyEnv(env[HAIBUN_RUN_POLICY]);
	}
	if (policyConfig) {
		if (!specl.runPolicy) {
			throw new Error(`${OPTION_RUN_POLICY} requires "runPolicy" in config.json`);
		}
		if (specl.appParameters && specl.appParameters[policyConfig.place]) {
			for (const [key, value] of Object.entries(specl.appParameters[policyConfig.place])) {
				protoOptions.options.envVariables[key] = String(value);
			}
		}

		loadAndValidateRunPolicy(policyConfig, specl.runPolicy);
	}
	return policyConfig;
}

function dryRunExit(featuresBackgrounds: TFeaturesBackgrounds, policyConfig?: TRunPolicyConfig, featureFilter?: string[]): never {
	const parts: string[] = [];
	if (policyConfig) parts.push(`place="${policyConfig.place}" policy=${policyConfig.dirFilters.map((f) => `${f.dir}:${f.access}`).join(",")}`);
	if (featureFilter?.length) parts.push(`filter=${featureFilter.join(",")}`);
	console.info(`\nDry-run: ${parts.length ? parts.join(" ") : "all features"}\n`);
	for (const f of featuresBackgrounds.features) {
		console.info(`  ✅ ${f.path}`);
	}
	console.info(`\n${featuresBackgrounds.features.length} features\n`);
	process.exit(0);
}

async function reportAndExit(executorResult: TExecutorResult, world: TWorld, protoOptions: TProtoOptions): Promise<never> {
	const showSummary = world.eventLogger.suppressConsole;

	if (executorResult.ok) {
		if (showSummary) {
			console.info(`\n${CHECK_YES} All ${executorResult.featureResults.length} features passed.`);
		}
	} else {
		const errorMessage = executorResult.failure?.error?.message || (world.runtime.exhaustionError && `Execution aborted: ${world.runtime.exhaustionError}`) || "Unknown error";
		const stage = executorResult.failure?.stage;

		console.error(`\n${CHECK_NO} ${stage ? `${stage} Error: ` : ""}${errorMessage}`);

		if (executorResult.failure?.error?.details) {
			const { ...otherDetails } = executorResult.failure.error.details;
			if (Object.keys(otherDetails).length > 0) {
				console.error("\nAdditional details:", otherDetails);
			}
		}
	}

	if (protoOptions.options[STAY] === STAY_ALWAYS) {
		await new Promise((resolve) => setTimeout(resolve, 1e9));
	} else if (!executorResult.ok && !protoOptions.options[STAY]) {
		process.exit(1);
	}
	process.exit(0);
}

function getCliWorld(protoOptions: TProtoOptions, bases: TBase): TWorld {
	const { KEY: keyIn } = protoOptions.options;
	const tag = getDefaultTag();
	const eventLogger = new EventLogger((name: string) => world.shared?.isSecret(name) ?? false);
	const timer = new Timer();

	Timer.key = keyIn || Timer.key;

	const world: Partial<TWorld> = {
		tag,
		runtime: { stepResults: [], observations: new Map<string, TAnyFixme>() },
		eventLogger,
		prompter: new Prompter(),
		...protoOptions,
		timer,
		bases,
	};
	const shared = new FeatureVariables(world as TWorld);
	world.shared = shared;
	const fullWorld = world as TWorld;
	fullWorld.domains = getCoreDomains(fullWorld);
	return fullWorld;
}

async function getSpeclOrExit(bases: TBase): Promise<TSpecl> {
	const specl = getConfigFromBase(bases);
	if (specl === null || bases?.length < 1) {
		if (specl === null) {
			await usageThenExit(specl ? specl : getDefaultOptions(), `missing or unusable config.json from ${bases} in ${process.cwd()}`);
		}
		await usageThenExit(specl ? specl : getDefaultOptions(), "no bases");
	}
	return specl;
}
export async function usageThenExit(specl: TSpecl, message?: string) {
	const output = await usage(specl, message);
	console[message ? "error" : "info"](output);
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
		"",
		`usage: ${process.argv[1]} [${OPTION_CONFIG} path/to/specific/config.json] [--cwd working_directory] [${OPTION_HELP}] [${OPTION_SHOW_STEPPERS}] [${OPTION_WITH_STEPPERS} stepper[,stepper]] [${OPTION_RUN_POLICY} place dir:access[,dir:access]] [${OPTION_DRY_RUN}] <project base[,project base]> <[filter,filter]>`,
		message || "",
		"If config.json is not found in project bases, the root directory will be used.\n",
		"Set these environmental variables to control options:\n",
		...Object.entries(BaseOptions.options).map(([k, v]) => `${BASE_PREFIX}${String(k).padEnd(55)} ${v.desc}`),
		`${HAIBUN_RUN_POLICY.padEnd(63)} run policy: "place dir:access[,dir:access]"`,
	];
	if (Object.keys(a).length) {
		ret.push("\nThese variables are available for extensions selected in config.js\n", ...Object.entries(a).map(([k, v]) => `${k.padEnd(55)} ${v.desc}`));
	}
	return [...ret, ""].join("\n");
}

export function processBaseEnvToOptionsAndErrors(env: TEnv) {
	const protoOptions: TProtoOptions = { options: { DEST: DEFAULT_DEST }, moduleOptions: {} };

	const errors: string[] = [];
	let nenv = {};

	const baseOptions = BaseOptions as IHasOptions;
	baseOptions.options && Object.entries(baseOptions.options).forEach(([k, v]) => ((protoOptions.options as Record<string, unknown>)[k] = v.default));

	Object.entries(env)
		.filter(([k]) => k.startsWith(BASE_PREFIX) && k !== HAIBUN_RUN_POLICY)
		.map(([k]) => {
			const value = env[k];
			const opt = k.replace(BASE_PREFIX, "");
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
					(protoOptions.options as Record<string, unknown>)[opt] = res.result;
				}
			} else if (opt.startsWith(`O_`)) {
				protoOptions.moduleOptions[k] = value;
			} else {
				errors.push(`no option for ${opt}`);
			}
		});
	protoOptions.options.envVariables = nenv;

	if (errors.length > 0) {
		throw new Error(errors.join("\n"));
	}

	return protoOptions;
}

export function processArgs(args: string[]) {
	let showHelp = false;
	let showSteppers = false;
	let withSteppers: string[] = [];
	let policyConfig: TRunPolicyConfig | undefined;
	let dryRun = false;
	const params = [];
	let configLoc;
	while (args.length > 0) {
		const cur = args.shift();

		if (cur === OPTION_CONFIG || cur === "-c") {
			configLoc = args.shift()?.replace(/\/config.json$/, "");
		} else if (cur === "--cwd") {
			process.chdir(args.shift());
		} else if (cur === OPTION_HELP || cur === "-h") {
			showHelp = true;
		} else if (cur === OPTION_SHOW_STEPPERS) {
			showSteppers = true;
		} else if (cur === OPTION_WITH_STEPPERS || cur?.startsWith(OPTION_WITH_STEPPERS + "=")) {
			// Support both --with-steppers value and --with-steppers=value
			let stepperList: string | undefined;
			if (cur?.includes("=")) {
				stepperList = cur.split("=")[1];
			} else {
				stepperList = args.shift();
			}
			if (stepperList) {
				withSteppers = withSteppers.concat(stepperList.split(",").map((s) => s.trim()));
			}
		} else if (cur === OPTION_RUN_POLICY) {
			const place = args.shift();
			const dirAccess = args.shift();
			if (!place || !dirAccess) throw new Error(`${OPTION_RUN_POLICY} requires place and dirAccess`);
			policyConfig = parseRunPolicyArgs(place, dirAccess);
		} else if (cur === OPTION_DRY_RUN) {
			dryRun = true;
		} else if (cur === "--stdio" || cur === "--node-ipc" || cur?.startsWith("--socket=")) {
			// Ignore LSP transport arguments (added by vscode-languageclient)
		} else {
			params.push(cur);
		}
	}
	return { params, configLoc, showHelp, showSteppers, withSteppers, policyConfig, dryRun };
}

export function getConfigFromBase(bases: TBase, fs: TFileSystem = nodeFS): TSpecl | null {
	// accept either full path with exact config filename or a directory that contains config.json
	const found = bases?.filter((b) => (b.endsWith("json") && fs.existsSync(b)) || fs.existsSync(`${b}/config.json`));
	if (found?.length > 1) {
		console.error(`Found multiple config.json files: ${found.join(", ")}. Use --config to specify one.`);
		return null;
	}
	const configCandidate = (found && found[0]) || ".";
	const f = configCandidate.endsWith("json") ? configCandidate : `${configCandidate}/config.json`;
	try {
		const speclRaw = JSON.parse(fs.readFileSync(f, "utf-8"));
		const specl = SpeclSchema.parse(speclRaw);
		if (!specl.options) {
			specl.options = { DEST: DEFAULT_DEST };
		}
		return specl;
	} catch (e: unknown) {
		const message = e instanceof Error ? e.message : String(e);
		console.error(`Could not read or parse ${f}: ${message}`);
		return null;
	}
}
