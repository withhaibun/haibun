/**
 * A run of the cli: it parses the command line and the environment, reads the configuration its bases name, and runs their
 * features or statements, each through the ports the program's entry point builds.
 */
import { newActualityId } from "@haibun/core/lib/rpc-wire.js";
import { HAIBUN_RECORD_NAMESPACE } from "@haibun/core/lib/domains/resources.js";
import { namesPackage, type TSpecl, type TFeaturesBackgrounds } from "@haibun/core/lib/actuality.js";
import { BASE_WITHOUT_FEATURES } from "@haibun/core/lib/actuality/ports.js";
import type { TBase, TBaseOptions, TProtoOptions, TWorld } from "@haibun/core/lib/world.js";
import { BASE_PREFIX, CHECK_NO, CHECK_YES, NDJSON, RECORDED_STATUS, STAY, STAY_ALWAYS, Timer, TExecutorResult } from "@haibun/core/lib/domains/protocol.js";
import { staysAfterActuality } from "@haibun/core/lib/actuality/derivations/actuality-end.js";
import { actualityEnded, actualityMachine } from "@haibun/core/lib/actuality/machines/actuality.js";
import type { IHasOptions } from "@haibun/core/lib/astepper.js";
import { resolveSitePrincipal } from "@haibun/core/lib/domains/host-id.js";
import { holdModuleOptions } from "@haibun/core/lib/held-module-options.js";
import { listedSteppers } from "@haibun/core/lib/steps/pipelines/discover-steps.js";
import { getPre, getDefaultOptions, basesFrom, verifyRequiredOptions, verifyExtraOptions, errorDetail, createSteppers } from "@haibun/core/lib/domains/util.js";
import { BaseOptions, processBaseEnvToOptionsAndErrors } from "../domains/base-options.js";
import { getDefaultTag } from "@haibun/core/lib/domains/ttag.js";
import { Runner } from "@haibun/core/lib/pipelines/runner.js";
import { FeatureVariables, secretsOf } from "@haibun/core/lib/feature-variables.js";
import { Prompter } from "@haibun/core/lib/prompts/pipelines/prompter.js";
import { getCoreDomains } from "@haibun/core/lib/pipelines/core-domains.js";
import { EventLogger } from "@haibun/core/lib/EventLogger.js";
import { OPTION_RUN_POLICY, OPTION_DRY_RUN, parseRunPolicyArgs, parseRunPolicyOption, type TRunPolicyConfig } from "@haibun/core/run-policy/domains/run-policy.js";
import { loadAndValidateRunPolicy } from "@haibun/core/run-policy/pipelines/policy-file.js";
import { PhaseRunner, PhaseBailError } from "@haibun/core/lib/PhaseRunner.js";
import { withName } from "@haibun/core/lib/domains/features.js";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import { configFileFrom, DOTENV, getConfigFromBase, readsDotenv } from "./specl.js";
import type { TCliPorts, TConfigFiles } from "../ports.js";
import { GROUP_OPTIONS } from "../domains/groups.js";
import { runGroups } from "./groups.js";

const OPTION_CONFIG = "--config";
const OPTION_HELP = "--help";
const OPTION_SHOW_STEPPERS = "--show-steppers";
const OPTION_WITH_STEPPERS = "--with-steppers";
/** Gives a statement on the command line. Each statement becomes one line of a feature. The option can be repeated.
 *  Statements run after any filtered features, or alone against the base's backgrounds. */
const OPTION_STATEMENT = "--statement";
/** Skips a group whose last run under the same conditions passed where every dependency holds the digest it held then. A run
 *  of features records its outcome with those digests whether or not this option is given. The CLI reads that record when
 *  this option or HAIBUN_ONCE is given. */
const OPTION_ONCE = "--once";

export async function runCli(args: string[], env: NodeJS.ProcessEnv, ports: TCliPorts) {
	if (args.includes(GROUP_OPTIONS.groups)) process.exit(await runGroups(args, ports));
	const parsed = processArgs(args);
	const bases = runBases(parsed.params[0], ports.fs);
	const configBases = parsed.configLoc ? [parsed.configLoc] : bases;
	const specl = await getSpeclOrExit(configBases, ports);
	if (readsDotenv(specl) && ports.fs.existsSync(DOTENV)) process.loadEnvFile(DOTENV);
	if (specl.env !== undefined) for (const [name, value] of Object.entries(specl.env)) env[name] ??= value;

	if (parsed.showHelp) return await usageThenExit(specl, ports.steppers);
	if (parsed.showSteppers) return await showSteppersAndExit(specl, ports.steppers);

	let world: TWorld | undefined;
	let protoOptions: TProtoOptions | undefined;
	let verification: ReturnType<TCliPorts["actualities"]["verificationOf"]>;

	try {
		const pr = new PhaseRunner();
		protoOptions = await pr.tryPhase("processBaseEnvToOptionsAndErrors", () => processBaseEnvToOptionsAndErrors(env, specl));
		holdModuleOptions(protoOptions.moduleOptions);

		world = getCliWorld(protoOptions, bases, ports);
		pr.world = world;
		const policyConfig = resolveRunPolicy(parsed.policyConfig, protoOptions, specl, ports.fs);
		const featureFilter = parsed.params[1] ? parsed.params[1].split(",") : undefined;

		// Holds the record file, the conditions key and the present digest of each dependency of a run of features, which the
		// actuality's record states. It is undefined for a run of statements, a rehearsal, or a run whose dependencies can't be read.
		verification =
			parsed.statements.length === 0 && !parsed.dryRun
				? ports.actualities.verificationOf({
						configPath: configFileFrom(configBases, ports.fs),
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
		if (verification) world.runtime.digest = verification.digest;
		if (runsOnce(parsed, protoOptions.options)) {
			const regardless = runsRegardless(parsed, protoOptions.options, verification !== undefined);
			if (regardless) console.info(`${OPTION_ONCE}: ${regardless}, so it runs`);
			// A group whose last run passed where every dependency holds the digest it held then would pass again, so it exits as
			// passed without running. A group whose last run failed runs again, so a person can retry a failure whose cause is
			// outside the sources without changing anything.
			else if (verification && ports.actualities.outcomeAgainst(verification) === RECORDED_STATUS.completed) return verifiedExit(bases);
		}

		const featuresBackgrounds = await pr.tryPhase("Collector", () => collect(ports, bases, featureFilter, parsed.statements, policyConfig));

		if (parsed.dryRun) return dryRunExit(featuresBackgrounds, policyConfig, featureFilter); // Exits process

		const { moduleOptions } = world;
		const csteppers = await pr.tryPhase("Steppers", async () => {
			const s = await ports.steppers([...specl.steppers, ...parsed.withSteppers]);
			verifyRequiredOptions(s, moduleOptions);
			verifyExtraOptions(moduleOptions, s);
			return s;
		});

		const runner = new Runner(world);
		const result = await runner.runFeaturesAndBackgrounds(csteppers, featuresBackgrounds);
		// An actuality without a feature result isn't evidence about the dependency state, so its state is cleared from the
		// actualities file. Otherwise the file holds its outcome against the state and each feature's duration, and the commit
		// holds the file, so its history holds the durations at each commit.
		if (verification && result.featureResults.length === 0) ports.actualities.forgetOutcome(verification);
		else if (verification) ports.actualities.recordActuality(verification, result, world.runtime.levels);

		await reportAndExit(result, world, protoOptions, ports);
	} catch (error) {
		// A PhaseBailError carries a result to report. Any other error ends the process with exit code 1.
		if (error instanceof PhaseBailError) {
			// An actuality that stopped before its features isn't evidence about the dependency state.
			if (verification) ports.actualities.forgetOutcome(verification);
			if (!world || !protoOptions) {
				console.error(`\n${CHECK_NO} ${error.message}`);
				const failure = error.result.failure;
				if (failure?.error.details) console.error("Additional details:", failure.error.details);
				process.exit(1);
			}
			return await reportAndExit(error.result, world, protoOptions, ports);
		}

		const message = PhaseRunner.formatError(error);

		// Tests mock process.exit to throw `exit with code N`. This branch rethrows that error to the test.
		if (message.startsWith("exit with code ")) throw error;

		// An actuality that ended in an error without a result isn't evidence about the dependency state. Clearing its entry
		// in the file keeps a later --once run from skipping the group.
		if (verification) ports.actualities.forgetOutcome(verification);
		console.error(`\n${CHECK_NO} ${message}`);
		process.exit(1);
	}
}

async function showSteppersAndExit(specl: TSpecl, steppers: TCliPorts["steppers"]) {
	console.info("Steppers:", JSON.stringify(listedSteppers(createSteppers(await steppers(specl.steppers))), null, 2));
	console.info(
		"Write each step as the text after its name. Quote a literal for a {placeholder}, or name a variable that a set step or the environment defines.\nStart a prose line with a capital letter and end it with one of [.!?:;]. ",
	);
	process.exit(0);
}

/** Returns the policy a run takes, from --run-policy or the RUN_POLICY option, and gives the features the parameters its config
 *  states for the policy's place. The config's `runPolicy` names the policy's schema by its path or by a package's export. Throws where
 *  a run has a policy and its config doesn't name a schema, or where the policy doesn't satisfy the schema. */
export function resolveRunPolicy(cliPolicyConfig: TRunPolicyConfig | undefined, protoOptions: TProtoOptions, specl: TSpecl, fs: TConfigFiles): TRunPolicyConfig | undefined {
	let policyConfig = cliPolicyConfig;
	const stated = protoOptions.options.RUN_POLICY;
	if (!policyConfig && stated !== undefined) policyConfig = parseRunPolicyOption(stated);
	if (policyConfig) {
		if (!specl.runPolicy) {
			throw new Error(`a run policy requires "runPolicy" in the config, naming the policy's schema. Add it, or run without ${OPTION_RUN_POLICY} and RUN_POLICY`);
		}
		const appParameters = specl.appParameters?.[policyConfig.place];
		if (appParameters) {
			protoOptions.options.envVariables = {
				...protoOptions.options.envVariables,
				...Object.fromEntries(Object.entries(appParameters).map(([key, value]) => [key, String(value)])),
			};
		}

		loadAndValidateRunPolicy(policyConfig, namesPackage(specl.runPolicy) ? fs.packageLocation(specl.runPolicy, process.cwd()) : specl.runPolicy, fs);
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

async function reportAndExit(executorResult: TExecutorResult, world: TWorld, protoOptions: TProtoOptions, ports: TCliPorts): Promise<never> {
	const showSummary = world.eventLogger.suppressConsole;

	const { featureResults } = executorResult;
	const failed = featureResults.filter(({ ok }) => !ok).length;
	const pending = featureResults.flatMap((result) => result.pending).length;
	const counted = `${featureResults.length - failed} features passed, ${failed} failed, and ${pending} scenarios are pending.`;
	if (executorResult.ok) {
		if (showSummary) {
			console.info(`\n${CHECK_YES} ${pending === 0 ? `All ${featureResults.length} features passed.` : counted}`);
		}
	} else {
		console.error(`\n${counted}`);
		const { failure } = executorResult;
		// A failed feature states its failure in its result, so only a phase's failure is stated here.
		if (failure !== undefined) console.error(`\n${CHECK_NO} ${failure.stage} Error: ${failure.error.message}`);

		if (failure?.error.details) {
			const { ...otherDetails } = failure.error.details;
			if (Object.keys(otherDetails).length > 0) {
				console.error("\nAdditional details:", otherDetails);
			}
		}
	}

	// Actuality stays to keep what its features started. Where a phase that sets the features up fails, the features don't start,
	// so the process exits and a launcher that waits on it reads its exit.
	if (actualityEnded(executorResult.actuality) && staysAfterActuality(protoOptions.options[STAY], executorResult.ok)) await ports.clock.wait(1e9);
	process.exit(executorResult.ok ? 0 : 1);
}

function getCliWorld(protoOptions: TProtoOptions, bases: TBase, ports: TCliPorts): TWorld {
	const { KEY: keyIn } = protoOptions.options;
	const tag = getDefaultTag();
	Timer.key = keyIn || Timer.key;

	const world: Partial<TWorld> = {
		tag,
		runtime: {
			actualityId: newActualityId(),
			records: HAIBUN_RECORD_NAMESPACE,
			actuality: actualityMachine(),
			levels: new Map(),
			stepResults: [],
			steps: { count: 0 },
			seqPaths: new Map(),
			keys: { principal: resolveSitePrincipal() },
		},
		prompter: new Prompter(ports.prompter),
		...protoOptions,
		clock: ports.clock,
		bases,
	};
	world.eventLogger = new EventLogger(secretsOf(world), ports.events, protoOptions.options[NDJSON] === true);
	const shared = new FeatureVariables(world as TWorld);
	world.shared = shared;
	const fullWorld = world as TWorld;
	fullWorld.domains = getCoreDomains(fullWorld);
	return fullWorld;
}

async function getSpeclOrExit(bases: TBase, ports: TCliPorts): Promise<TSpecl> {
	let specl: TSpecl;
	try {
		specl = getConfigFromBase(bases, ports.fs);
	} catch (e: unknown) {
		return await usageThenExit(getDefaultOptions(), ports.steppers, `${errorDetail(e)}; the bases are ${bases} in ${process.cwd()}`);
	}
	if (bases.length < 1) return await usageThenExit(specl, ports.steppers, "the command doesn't name a base");
	return specl;
}
export async function usageThenExit(specl: TSpecl, steppers: TCliPorts["steppers"], message?: string): Promise<never> {
	const output = await usage(specl, steppers, message);
	console[message ? "error" : "info"](output);
	process.exit(message ? 1 : 0);
}

export async function usage(specl: TSpecl, loaded: TCliPorts["steppers"], message?: string) {
	const steppers = createSteppers(await loaded(specl.steppers));
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
		`   or: ${process.argv[1]} ${GROUP_OPTIONS.groups} [${GROUP_OPTIONS.set} set] [${GROUP_OPTIONS.environments} environment[,environment]] [${GROUP_OPTIONS.list}] [config or directory ...] (runs each group of features a config declares, with the other options)`,
		message || "",
		"The working directory's config.json is used when the project bases don't contain a config.json.\n",
		"Set these environment variables to control options:\n",
		...Object.entries(BaseOptions.options).map(([k, v]) => `${BASE_PREFIX}${String(k).padEnd(55)} ${v.desc}`),
	];
	if (Object.keys(a).length) {
		ret.push("\nThese variables set options of the steppers that config.json lists:\n", ...Object.entries(a).map(([k, v]) => `${k.padEnd(55)} ${v.desc}`));
	}
	return [...ret, ""].join("\n");
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
export async function collect(
	{ features, fs }: Pick<TCliPorts, "features" | "fs">,
	bases: TBase,
	featureFilter: string[] | undefined,
	statements: string[],
	policyConfig?: TRunPolicyConfig,
): Promise<TFeaturesBackgrounds> {
	if (statements.length === 0) return await features.collect(bases, featureFilter, policyConfig);
	const statementFeature = withName(itemAt(bases, 0), "statement.feature", statements.join("\n"));
	if (featureFilter) {
		const collected = await features.collect(bases, featureFilter, policyConfig);
		return { features: [...collected.features, statementFeature], backgrounds: collected.backgrounds };
	}
	// A filter that doesn't match a feature collects the base's backgrounds alone. Statements still run against a base
	// that doesn't exist or doesn't hold features or backgrounds. emptyIfNoFeatures rethrows any other collector error.
	const holdsNothing = !fs.existsSync(itemAt(bases, 0));
	const backgrounds = holdsNothing ? [] : (await features.collect(bases, [NO_FEATURE_MATCHES], policyConfig).catch(emptyIfNoFeatures)).backgrounds;
	return { features: [statementFeature], backgrounds };
}

/** Returns the bases a command line names, comma-separated: each a directory by its path, or by a package's export, such as
 *  `@haibun/shu/waypoints`, which is found from the working directory as Node finds a package. */
export function runBases(named: string | undefined, fs: TConfigFiles): TBase {
	return basesFrom(named?.replace(/\/$/, "")).map((base) => (namesPackage(base) ? fs.packageLocation(base, process.cwd()) : base));
}

/** Returns why a run given --once runs without reading the record of its group's last run, or undefined where a recorded pass
 *  skips it. A rehearsal, a run of statements and a run of features whose dependencies can't be read don't record a pass. A run
 *  that stays after its features end, such as a launched instance or a service, serves what they start, which a pass doesn't. */
export function runsRegardless(parsed: { dryRun: boolean; statements: readonly string[] }, options: TBaseOptions, verified: boolean): string | undefined {
	if (parsed.dryRun) return "a rehearsal doesn't record a pass against its dependencies";
	if (parsed.statements.length > 0) return "a run of statements doesn't record a pass against its dependencies";
	if (options[STAY] === STAY_ALWAYS) return "a run that stays after its features end serves what they start, which a recorded pass doesn't";
	return verified ? undefined : "a run of features that depends on an untracked directory doesn't record a pass against its dependencies";
}

/** Returns whether the CLI reads the record of a group's last run before it runs the group. `--once` sets this for one
 *  run. `HAIBUN_ONCE` sets it for every run that inherits the environment. */
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
