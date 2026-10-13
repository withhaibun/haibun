import nodeFS from "fs";
import { newActualityId } from "@haibun/core/lib/rpc-wire.js";
import path from "node:path";

import { type TSpecl, SpeclSchema } from "@haibun/core/lib/execution.js";
import { BaseOptionsSchema, type TBase, type TBaseOptions, type TModuleOptions, type TProtoOptions, type TWorld } from "@haibun/core/lib/world.js";
import { BASE_PREFIX, CHECK_NO, CHECK_YES, DEFAULT_DEST, MODULE_OPTION_PREFIX, NDJSON, RECORDED_STATUS, STAY, Timer, TExecutorResult } from "@haibun/core/schema/protocol.js";
import { staysAfterExecution } from "@haibun/core/phases/Executor.js";
import { IHasOptions } from "@haibun/core/lib/astepper.js";
import { resolveSitePrincipal } from "@haibun/core/lib/host-id.js";
import { formattedSteppers, getPre, getDefaultOptions, basesFrom, verifyRequiredOptions, verifyExtraOptions, errorDetail } from "@haibun/core/lib/util/index.js";
import { BaseOptions } from "./BaseOptions.js";
import { TFileSystem, getCreateSteppers, getSteppers } from "@haibun/core/lib/util/node/workspace-lib.js";
import { getDefaultTag } from "@haibun/core/lib/ttag.js";
import { Runner } from "@haibun/core/runner.js";
import { FeatureVariables } from "@haibun/core/lib/feature-variables.js";
import { Prompter } from "@haibun/core/lib/prompter.js";
import { getCoreDomains } from "@haibun/core/lib/core-domains.js";
import { EventLogger } from "@haibun/core/lib/EventLogger.js";
import { TAnyFixme } from "@haibun/core/lib/fixme.js";
import { OPTION_RUN_POLICY, OPTION_DRY_RUN, HAIBUN_RUN_POLICY, parseRunPolicyArgs, parseRunPolicyEnv, type TRunPolicyConfig } from "@haibun/core/run-policy/run-policy-types.js";
import { loadAndValidateRunPolicy } from "@haibun/core/run-policy/run-policy-schema.js";
import { PhaseRunner, PhaseBailError } from "@haibun/core/lib/PhaseRunner.js";
import { BASE_WITHOUT_FEATURES, getFeaturesAndBackgrounds, TFeaturesBackgrounds } from "@haibun/core/phases/collector.js";
import { withName } from "@haibun/core/lib/features.js";
import { forgetOutcome, outcomeAgainst, recordOutcome, verificationOf } from "./verified.js";
import { recordTimings, varianceLine } from "./timings.js";

const OPTION_CONFIG = "--config";
const OPTION_HELP = "--help";
const OPTION_SHOW_STEPPERS = "--show-steppers";
const OPTION_WITH_STEPPERS = "--with-steppers";
/** Gives a statement on the command line. Each statement becomes one line of a feature. The option can be repeated.
 *  Statements run after any filtered features, or alone against the base's backgrounds. */
const OPTION_STATEMENT = "--statement";
/** Skips a group whose last run under the same conditions passed against the present dependency state. A run of
 *  features records its outcome against its dependency state whether or not this option is given. The CLI reads that
 *  record when this option or HAIBUN_ONCE is given. */
const OPTION_ONCE = "--once";

type TEnv = { [name: string]: string | undefined };

export async function runCli(args: string[], env: NodeJS.ProcessEnv) {
	if (nodeFS.existsSync(".env")) process.loadEnvFile();
	const parsed = processArgs(args);
	const bases = basesFrom(parsed.params[0]?.replace(/\/$/, ""));
	const configBases = parsed.configLoc ? [parsed.configLoc] : bases;
	const specl = await getSpeclOrExit(configBases);

	if (parsed.showHelp) return await usageThenExit(specl);
	if (parsed.showSteppers) return await showSteppersAndExit(specl);

	let world: TWorld | undefined;
	let protoOptions: TProtoOptions | undefined;
	let verification: ReturnType<typeof verificationOf>;

	try {
		const pr = new PhaseRunner();
		protoOptions = await pr.tryPhase("processBaseEnvToOptionsAndErrors", () => processBaseEnvToOptionsAndErrors(env, specl));

		world = getCliWorld(protoOptions, bases);
		pr.world = world;
		const policyConfig = resolveRunPolicy(parsed.policyConfig, env, protoOptions, specl);
		const featureFilter = parsed.params[1] ? parsed.params[1].split(",") : undefined;

		// Holds the record file, the conditions key and the present dependency state of a run of features. It is undefined
		// for a run of statements, a rehearsal, or a run whose dependency state can't be read.
		verification =
			parsed.statements.length === 0 && !parsed.dryRun
				? verificationOf({
						configPath: configFileFrom(configBases),
						specl,
						bases,
						cwd: process.cwd(),
						filter: featureFilter ?? [],
						options: protoOptions.options,
						moduleOptions: protoOptions.moduleOptions,
						policy: policyConfig,
						withSteppers: parsed.withSteppers,
					})
				: undefined;
		if (runsOnce(parsed, protoOptions.options)) {
			if (!verification)
				console.info(
					`${OPTION_ONCE}: ${parsed.dryRun ? "a rehearsal" : parsed.statements.length ? "a run of statements" : "a run of features that depends on an untracked directory"} doesn't record a pass against its dependencies, so it runs`,
				);
			// A group whose last run passed against the present dependency state would pass again, so it exits as passed
			// without running. A group whose last run failed runs again, so a person can retry a failure whose cause is
			// outside the sources without changing anything.
			else if (outcomeAgainst(verification)?.outcome === RECORDED_STATUS.completed) return verifiedExit(bases);
		}

		const featuresBackgrounds = await pr.tryPhase("Collector", () => collect(bases, featureFilter, parsed.statements, policyConfig));

		if (parsed.dryRun) return dryRunExit(featuresBackgrounds, policyConfig, featureFilter); // Exits process

		const { moduleOptions } = world;
		const csteppers = await pr.tryPhase("Steppers", async () => {
			const s = await getSteppers([...specl.steppers, ...parsed.withSteppers]);
			verifyRequiredOptions(s, moduleOptions);
			verifyExtraOptions(moduleOptions, s);
			return s;
		});

		const runner = new Runner(world);
		const result = await runner.runFeaturesAndBackgrounds(csteppers, featuresBackgrounds);
		// A run without a feature result isn't evidence about the dependency state, so its entry in the record is deleted.
		if (verification && result.featureResults.length === 0) forgetOutcome(verification);
		else if (verification) recordOutcome(verification, result.ok ? RECORDED_STATUS.completed : RECORDED_STATUS.failed, result.featureResults.length);
		// Writes each feature's duration to timings.json beside the config. The file's git history holds the durations at
		// each commit. Timings measure durations and don't verify a state, so they are written whether or not a run is verified.
		if (parsed.statements.length === 0 && result.featureResults.length > 0) {
			const variances = recordTimings(path.dirname(path.resolve(configFileFrom(configBases))), result, featureFilter !== undefined);
			for (const variance of variances) console.info(`timings: ${varianceLine(variance)}`);
		}

		await reportAndExit(result, world, protoOptions);
	} catch (error) {
		// A PhaseBailError carries a result to report. Any other error ends the process with exit code 1.
		if (error instanceof PhaseBailError) {
			// A run that stopped before its features isn't evidence about the dependency state.
			if (verification) forgetOutcome(verification);
			if (!world || !protoOptions) {
				const failure = error.result.failure;
				const stage = failure?.stage ?? "?";
				console.error(`\n${CHECK_NO} ${stage} Error: ${failure?.error?.message ?? "unknown"}`);
				if (failure?.error?.details) console.error("Additional details:", failure.error.details);
				process.exit(1);
			}
			return await reportAndExit(error.result, world, protoOptions);
		}

		const message = PhaseRunner.formatError(error);

		// Tests mock process.exit to throw `exit with code N`. This branch rethrows that error to the test.
		if (message.startsWith("exit with code ")) throw error;

		// A run that ended in an error without a result isn't evidence about the dependency state. Deleting its entry in
		// the record keeps a later --once run from skipping the group.
		if (verification) forgetOutcome(verification);
		console.error(`\n${CHECK_NO} ${message}`);
		process.exit(1);
	}
}

async function showSteppersAndExit(specl: TSpecl) {
	const allSteppers = await getAllSteppers(specl);
	console.info("Steppers:", JSON.stringify(allSteppers, null, 2));
	console.info(
		"Write each step as the text after its name. Quote a literal for a {placeholder}, or name a variable that a set step or the environment defines.\nStart a prose line with a capital letter and end it with one of [.!?:;]. ",
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
		const appParameters = specl.appParameters?.[policyConfig.place];
		if (appParameters) {
			protoOptions.options.envVariables = {
				...protoOptions.options.envVariables,
				...Object.fromEntries(Object.entries(appParameters).map(([key, value]) => [key, String(value)])),
			};
		}

		loadAndValidateRunPolicy(policyConfig, specl.runPolicy);
	}
	return policyConfig;
}

/** Reports the recorded pass and exits with 0, for a group whose dependencies haven't changed since it passed. */
function verifiedExit(bases: TBase): never {
	console.info(`\n${CHECK_YES} ${bases.join(",")} passed, and its dependencies haven't changed since then, so it did not run. Run without ${OPTION_ONCE} to run it anyway.\n`);
	process.exit(0);
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

	if (staysAfterExecution(protoOptions.options[STAY], executorResult.ok)) await new Promise((resolve) => setTimeout(resolve, 1e9));
	process.exit(executorResult.ok ? 0 : 1);
}

function getCliWorld(protoOptions: TProtoOptions, bases: TBase): TWorld {
	const { KEY: keyIn } = protoOptions.options;
	const tag = getDefaultTag();
	const eventLogger = new EventLogger((name: string) => world.shared?.isSecret(name) ?? false, protoOptions.options[NDJSON] === true);
	const timer = new Timer();

	Timer.key = keyIn || Timer.key;

	const world: Partial<TWorld> = {
		tag,
		runtime: { actualityId: newActualityId(), stepResults: [], observations: new Map<string, TAnyFixme>(), keys: { principal: resolveSitePrincipal() } },
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
	if (specl === null) return await usageThenExit(getDefaultOptions(), `missing or unusable config.json from ${bases} in ${process.cwd()}`);
	if (bases.length < 1) return await usageThenExit(specl, "the command doesn't name a base");
	return specl;
}
export async function usageThenExit(specl: TSpecl, message?: string): Promise<never> {
	const output = await usage(specl, message);
	console[message ? "error" : "info"](output);
	process.exit(message ? 1 : 0);
}

async function getAllSteppers(specl: TSpecl) {
	const steppers = await getCreateSteppers(specl.steppers);
	return formattedSteppers(steppers);
}

export async function usage(specl: TSpecl, message?: string) {
	const steppers = await getCreateSteppers(specl.steppers);
	let a: { [name: string]: { desc: string } } = {};
	steppers.forEach((s) => {
		const { options } = s as IHasOptions;
		if (options) {
			const p = getPre(s);
			a = { ...a, ...Object.fromEntries(Object.entries(options).map(([name, option]) => [`${p}${name}`, option])) };
		}
	});

	const ret = [
		"",
		`usage: ${process.argv[1]} [${OPTION_CONFIG} path/to/specific/config.json] [--cwd working_directory] [${OPTION_HELP}] [${OPTION_SHOW_STEPPERS}] [${OPTION_WITH_STEPPERS} stepper[,stepper]] [${OPTION_RUN_POLICY} place dir:access[,dir:access]] [${OPTION_STATEMENT} "a haibun statement" (repeatable; runs after any filtered features, or alone)] [${OPTION_DRY_RUN}] [${OPTION_ONCE} (skip a group whose last run passed against unchanged dependencies)] <project base[,project base]> <[filter,filter]>`,
		message || "",
		"The working directory's config.json is used when the project bases don't contain a config.json.\n",
		"Set these environment variables to control options:\n",
		...Object.entries(BaseOptions.options).map(([k, v]) => `${BASE_PREFIX}${String(k).padEnd(55)} ${v.desc}`),
		`${HAIBUN_RUN_POLICY.padEnd(63)} run policy: "place dir:access[,dir:access]"`,
	];
	if (Object.keys(a).length) {
		ret.push("\nThese variables set options of the steppers that config.json lists:\n", ...Object.entries(a).map(([k, v]) => `${k.padEnd(55)} ${v.desc}`));
	}
	return [...ret, ""].join("\n");
}

/** Returns a run's options. A base option takes its default unless the environment sets it. A module option takes the
 *  base config's value unless an environment variable sets it. Throws where an environment value doesn't parse or
 *  doesn't name an option. */
export function processBaseEnvToOptionsAndErrors(env: TEnv, specl: TSpecl): TProtoOptions {
	const options: Record<string, unknown> = { DEST: DEFAULT_DEST };
	const moduleOptions: TModuleOptions = { ...specl.moduleOptions };

	const errors: string[] = [];
	let nenv = {};

	const baseOptions = (BaseOptions as IHasOptions).options ?? {};
	for (const [k, v] of Object.entries(baseOptions)) if (v.default !== undefined) options[k] = v.default;

	for (const [k, value] of Object.entries(env)) {
		if (value === undefined || !k.startsWith(BASE_PREFIX) || k === HAIBUN_RUN_POLICY) continue;
		const opt = k.replace(BASE_PREFIX, "");
		const baseOption = baseOptions[opt];

		if (baseOption) {
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
		} else if (k.startsWith(MODULE_OPTION_PREFIX)) {
			moduleOptions[k] = value;
		} else {
			errors.push(`${opt} isn't an option`);
		}
	}
	options.envVariables = nenv;

	if (errors.length > 0) {
		throw new Error(errors.join("\n"));
	}

	return { options: BaseOptionsSchema.parse(options), moduleOptions };
}

/** A filter that a feature path can't contain. Collecting with it returns the base's backgrounds without its features. */
const NO_FEATURE_MATCHES = "\u0000no-feature-matches";

/** Returns empty features and backgrounds for a base that doesn't hold either, since statements run without them. Any
 *  other error is rethrown. */
const emptyIfNoFeatures = (e: unknown): TFeaturesBackgrounds => {
	if (!String((e as Error)?.message ?? e).includes(BASE_WITHOUT_FEATURES)) throw e;
	return { features: [], backgrounds: [] };
};

/**
 * Collects what a run executes: the base's features, statements given on the command line, or both.
 *
 * The filtered features run before the statements in the same run when a filter and statements are both given. The
 * statements act on the state the features set up, such as a store, a served app or seeded data. A probe uses this
 * order to try lines without copying the setup into the command or writing a temporary feature file. Statements alone
 * run against the base's backgrounds.
 */
export async function collect(bases: TBase, featureFilter: string[] | undefined, statements: string[], policyConfig?: TRunPolicyConfig): Promise<TFeaturesBackgrounds> {
	if (statements.length === 0) return await getFeaturesAndBackgrounds(bases, featureFilter, policyConfig);
	const statementFeature = withName(bases[0] ?? ".", "statement.feature", statements.join("\n"));
	if (featureFilter) {
		const collected = await getFeaturesAndBackgrounds(bases, featureFilter, policyConfig);
		return { features: [...collected.features, statementFeature], backgrounds: collected.backgrounds };
	}
	// A filter that doesn't match a feature collects the base's backgrounds alone. Statements still run against a base
	// that doesn't exist or doesn't hold features or backgrounds. emptyIfNoFeatures rethrows any other collector error.
	const holdsNothing = !nodeFS.existsSync(bases[0] ?? ".");
	const backgrounds = holdsNothing ? [] : (await getFeaturesAndBackgrounds(bases, [NO_FEATURE_MATCHES], policyConfig).catch(emptyIfNoFeatures)).backgrounds;
	return { features: [statementFeature], backgrounds };
}

/** Returns whether the CLI reads the record of a group's last run before it runs the group. `--once` sets this for one
 *  run. `HAIBUN_ONCE` sets it for every run a script chains. */
export function runsOnce(parsed: { once: boolean }, options: TBaseOptions): boolean {
	return parsed.once || options.ONCE === true;
}

export function processArgs(args: string[]) {
	let showHelp = false;
	let showSteppers = false;
	let withSteppers: string[] = [];
	let policyConfig: TRunPolicyConfig | undefined;
	let dryRun = false;
	let once = false;
	const statements: string[] = [];
	const params = [];
	let configLoc;
	while (args.length > 0) {
		const cur = args.shift();

		if (cur === OPTION_CONFIG || cur === "-c") {
			configLoc = args.shift()?.replace(/\/config.json$/, "");
		} else if (cur === "--cwd") {
			const dir = args.shift();
			if (!dir) throw new Error("--cwd requires a working directory");
			process.chdir(dir);
		} else if (cur === OPTION_HELP || cur === "-h") {
			showHelp = true;
		} else if (cur === OPTION_SHOW_STEPPERS) {
			showSteppers = true;
		} else if (cur === OPTION_WITH_STEPPERS || cur?.startsWith(OPTION_WITH_STEPPERS + "=")) {
			// Accepts both --with-steppers value and --with-steppers=value.
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
		} else if (cur === OPTION_STATEMENT || cur?.startsWith(OPTION_STATEMENT + "=")) {
			const statement = cur.includes("=") ? cur.slice(OPTION_STATEMENT.length + 1) : args.shift();
			if (!statement) throw new Error(`${OPTION_STATEMENT} requires a statement`);
			statements.push(statement);
		} else if (cur === OPTION_DRY_RUN) {
			dryRun = true;
		} else if (cur === OPTION_ONCE) {
			once = true;
		} else if (cur === "--stdio" || cur === "--node-ipc" || cur?.startsWith("--socket=")) {
			// Ignores the LSP transport arguments that vscode-languageclient adds.
		} else {
			params.push(cur);
		}
	}
	return { params, configLoc, showHelp, showSteppers, withSteppers, policyConfig, dryRun, once, statements };
}

/** Returns the configuration file a run reads. The first base that is an existing JSON file or a directory that
 *  contains config.json gives that file. The working directory's config.json is the fallback. */
function configFileFrom(bases: TBase, fs: TFileSystem = nodeFS): string {
	const found = bases?.filter((b) => (b.endsWith("json") && fs.existsSync(b)) || fs.existsSync(`${b}/config.json`));
	const configCandidate = (found && found[0]) || ".";
	return configCandidate.endsWith("json") ? configCandidate : `${configCandidate}/config.json`;
}

export function getConfigFromBase(bases: TBase, fs: TFileSystem = nodeFS): TSpecl | null {
	// Accepts a path to a JSON config file or a directory that contains config.json.
	const found = bases?.filter((b) => (b.endsWith("json") && fs.existsSync(b)) || fs.existsSync(`${b}/config.json`));
	if (found?.length > 1) {
		console.error(`Found multiple config.json files: ${found.join(", ")}. Use --config to specify one.`);
		return null;
	}
	const f = configFileFrom(bases, fs);
	try {
		const speclRaw = JSON.parse(fs.readFileSync(f, "utf-8"));
		const specl = SpeclSchema.parse(speclRaw);
		if (!specl.options) {
			specl.options = { DEST: DEFAULT_DEST };
		}
		return specl;
	} catch (e: unknown) {
		const message = errorDetail(e);
		console.error(`Could not read or parse ${f}: ${message}`);
		return null;
	}
}
