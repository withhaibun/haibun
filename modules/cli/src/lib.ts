import nodeFS from "fs";
import { newActualityId } from "@haibun/core/lib/rpc-wire.js";
import path from "node:path";

import { type TSpecl, SpeclSchema } from "@haibun/core/lib/execution.js";
import { BaseOptionsSchema, type TBase, type TBaseOptions, type TModuleOptions, type TProtoOptions, type TWorld } from "@haibun/core/lib/world.js";
import { BASE_PREFIX, CHECK_NO, CHECK_YES, DEFAULT_DEST, MODULE_OPTION_PREFIX, NDJSON, STAY, Timer, TExecutorResult } from "@haibun/core/schema/protocol.js";
import { staysAfterExecution } from "@haibun/core/phases/Executor.js";
import { IHasOptions } from "@haibun/core/lib/astepper.js";
import { getCreateSteppers, getDefaultTag } from "@haibun/core/lib/test/lib.js";
import { resolveSitePrincipal } from "@haibun/core/lib/host-id.js";
import { formattedSteppers, getPre, getDefaultOptions, basesFrom, verifyRequiredOptions, verifyExtraOptions, errorDetail } from "@haibun/core/lib/util/index.js";
import { BaseOptions } from "./BaseOptions.js";
import { TFileSystem, getSteppers } from "@haibun/core/lib/util/node/workspace-lib.js";
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
import { withNameType } from "@haibun/core/lib/features.js";
import { forgetOutcome, outcomeAgainst, recordOutcome, verificationOf } from "./verified.js";
import { recordTimings, varianceLine } from "./timings.js";

const OPTION_CONFIG = "--config";
const OPTION_HELP = "--help";
const OPTION_SHOW_STEPPERS = "--show-steppers";
const OPTION_WITH_STEPPERS = "--with-steppers";
/** Run statements given on the command line instead of collecting feature files. Repeatable; each is one line. */
const OPTION_STATEMENT = "--statement";
/** Run a group only when one of its dependencies changed since the group last passed. Every whole run records how it
 *  went and the state of its dependencies; this option is what reads that record. */
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

		// What this run is verified against, where it is a run of features rather than of statements or a rehearsal.
		// A run that has passed against the state its dependencies have now would answer what that run answered.
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
					`${OPTION_ONCE}: this run doesn't have dependencies to record a pass against (${parsed.dryRun ? "a rehearsal" : parsed.statements.length ? "a run of statements" : "features outside a repository"}), so it runs`,
				);
			// A group that passed and whose dependencies haven't changed since would pass again. A group that failed runs again: what a person
			// does with a failure is retry it, and a run that fails for a reason outside the sources is one they must be
			// able to retry without changing anything.
			else if (outcomeAgainst(verification)?.outcome === "passed") return verifiedExit(bases);
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
		// A run that didn't reach its features isn't evidence about them: what stopped it was before them.
		if (verification && result.featureResults.length === 0) forgetOutcome(verification);
		else if (verification) recordOutcome(verification, result.ok ? "passed" : "failed", result.featureResults.length);
		// What a run of features took, kept with the code: the file's history is what each feature takes, change by change.
		// A measurement rather than a decision, so it is written whether or not the run is verified against anything.
		if (parsed.statements.length === 0 && result.featureResults.length > 0) {
			const variances = recordTimings(path.dirname(path.resolve(configFileFrom(configBases))), result, featureFilter !== undefined);
			for (const variance of variances) console.info(`timings: ${varianceLine(variance)}`);
		}

		await reportAndExit(result, world, protoOptions);
	} catch (error) {
		// Final Error "Nothing" Branch
		if (error instanceof PhaseBailError) {
			// A run that did not get as far as its features isn't evidence about the state they depend on.
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

		// Vitest mocks process.exit as throwing an error. Let it bubble so tests pass.
		if (message.startsWith("exit with code ")) throw error;

		// A run that ended in an error it did not report as a result isn't evidence about the state, and what stood
		// before it is not left standing over it.
		if (verification) forgetOutcome(verification);
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

/** Reports the pass and exits as one, for a group that passed and whose dependencies haven't changed since then. */
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
		`usage: ${process.argv[1]} [${OPTION_CONFIG} path/to/specific/config.json] [--cwd working_directory] [${OPTION_HELP}] [${OPTION_SHOW_STEPPERS}] [${OPTION_WITH_STEPPERS} stepper[,stepper]] [${OPTION_RUN_POLICY} place dir:access[,dir:access]] [${OPTION_STATEMENT} "a haibun statement" (repeatable; runs after any filtered features, or alone)] [${OPTION_DRY_RUN}] [${OPTION_ONCE} (run only if a dependency changed since the group passed)] <project base[,project base]> <[filter,filter]>`,
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

/** A run's options: base options from the environment, and module options from the base's config with the environment
 *  stating an option over it. */
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

/**
 * What a run executes: the collected features, statements given on the command line, or both.
 *
 * With a filter AND statements, the filtered features run FIRST and the statements after them, in the same run, so
 * the features are the precedent the statements act on. That is what a probe usually needs: whatever a feature
 * already sets up (a store, a served app, seeded data), then the lines being tried, without copying the setup into
 * the command or writing a throwaway feature file. Statements alone run against the base's backgrounds.
 */
/** A filter that a feature path can't hold, so a collect returns the base's backgrounds without its features. */
const NO_FEATURE_MATCHES = "\u0000no-feature-matches";

/** A base that doesn't hold features or backgrounds is not an error when only statements are being run. */
const emptyIfNoFeatures = (e: unknown): TFeaturesBackgrounds => {
	if (!String((e as Error)?.message ?? e).includes(BASE_WITHOUT_FEATURES)) throw e;
	return { features: [], backgrounds: [] };
};

export async function collect(bases: TBase, featureFilter: string[] | undefined, statements: string[], policyConfig?: TRunPolicyConfig): Promise<TFeaturesBackgrounds> {
	if (statements.length === 0) return await getFeaturesAndBackgrounds(bases, featureFilter, policyConfig);
	const statementFeature = withNameType(bases[0] ?? ".", "statement.feature", statements.join("\n"));
	if (featureFilter) {
		const collected = await getFeaturesAndBackgrounds(bases, featureFilter, policyConfig);
		return { features: [...collected.features, statementFeature], backgrounds: collected.backgrounds };
	}
	// The base's backgrounds, without its features: a filter that doesn't match a feature collects the backgrounds alone. A
	// base that doesn't hold either is a base a statement can still run against, and only that case is passed over; anything
	// else the collector refuses is the caller's to hear about.
	const holdsNothing = !nodeFS.existsSync(bases[0] ?? ".");
	const backgrounds = holdsNothing ? [] : (await getFeaturesAndBackgrounds(bases, [NO_FEATURE_MATCHES], policyConfig).catch(emptyIfNoFeatures)).backgrounds;
	return { features: [statementFeature], backgrounds };
}

/** Whether a run is verified against its last pass: asked for on the command line, or by `HAIBUN_ONCE` for every run a
 *  script chains. */
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
		} else if (cur === OPTION_STATEMENT || cur?.startsWith(OPTION_STATEMENT + "=")) {
			const statement = cur.includes("=") ? cur.slice(OPTION_STATEMENT.length + 1) : args.shift();
			if (!statement) throw new Error(`${OPTION_STATEMENT} requires a statement`);
			statements.push(statement);
		} else if (cur === OPTION_DRY_RUN) {
			dryRun = true;
		} else if (cur === OPTION_ONCE) {
			once = true;
		} else if (cur === "--stdio" || cur === "--node-ipc" || cur?.startsWith("--socket=")) {
			// Ignore LSP transport arguments (added by vscode-languageclient)
		} else {
			params.push(cur);
		}
	}
	return { params, configLoc, showHelp, showSteppers, withSteppers, policyConfig, dryRun, once, statements };
}

/** The configuration file a run reads: a base that names the file, else the one whose directory holds config.json,
 *  else the working directory's. */
function configFileFrom(bases: TBase, fs: TFileSystem = nodeFS): string {
	const found = bases?.filter((b) => (b.endsWith("json") && fs.existsSync(b)) || fs.existsSync(`${b}/config.json`));
	const configCandidate = (found && found[0]) || ".";
	return configCandidate.endsWith("json") ? configCandidate : `${configCandidate}/config.json`;
}

export function getConfigFromBase(bases: TBase, fs: TFileSystem = nodeFS): TSpecl | null {
	// accept either full path with exact config filename or a directory that contains config.json
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
