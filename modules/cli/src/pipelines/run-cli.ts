/**
 * A run of the cli: it parses the command line and the environment, reads the configuration its bases name, and runs their
 * features or statements, each through the ports the program's entry point builds.
 */
import { newActualityId } from "@haibun/core/lib/rpc-wire.js";
import type { TSpecl, TFeaturesBackgrounds } from "@haibun/core/lib/execution.js";
import { BASE_WITHOUT_FEATURES } from "@haibun/core/lib/actuality/ports.js";
import type { TBase, TBaseOptions, TProtoOptions, TWorld } from "@haibun/core/lib/world.js";
import { BASE_PREFIX, CHECK_NO, CHECK_YES, NDJSON, RECORDED_STATUS, STAY, Timer, TExecutorResult } from "@haibun/core/lib/domains/protocol.js";
import { staysAfterExecution } from "@haibun/core/lib/actuality/derivations/execution-end.js";
import { actualityMachine } from "@haibun/core/lib/actuality/machines/actuality.js";
import type { IHasOptions } from "@haibun/core/lib/astepper.js";
import { resolveSitePrincipal } from "@haibun/core/lib/domains/host-id.js";
import { holdModuleOptions } from "@haibun/core/lib/held-module-options.js";
import { formattedSteppers, getPre, getDefaultOptions, basesFrom, verifyRequiredOptions, verifyExtraOptions, errorDetail, createSteppers } from "@haibun/core/lib/domains/util.js";
import { BaseOptions, processBaseEnvToOptionsAndErrors } from "../domains/base-options.js";
import type { TFileSystem } from "@haibun/core/lib/adapters/workspace-lib.js";
import { getDefaultTag } from "@haibun/core/lib/domains/ttag.js";
import { Runner } from "@haibun/core/lib/pipelines/runner.js";
import { FeatureVariables, secretsOf } from "@haibun/core/lib/feature-variables.js";
import { Prompter } from "@haibun/core/lib/prompts/pipelines/prompter.js";
import { getCoreDomains } from "@haibun/core/lib/pipelines/core-domains.js";
import { EventLogger } from "@haibun/core/lib/EventLogger.js";
import { OPTION_RUN_POLICY, OPTION_DRY_RUN, HAIBUN_RUN_POLICY, parseRunPolicyArgs, parseRunPolicyEnv, type TRunPolicyConfig } from "@haibun/core/run-policy/domains/run-policy.js";
import { loadAndValidateRunPolicy } from "@haibun/core/run-policy/pipelines/policy-file.js";
import { PhaseRunner, PhaseBailError } from "@haibun/core/lib/PhaseRunner.js";
import { withName } from "@haibun/core/lib/domains/features.js";
import { configFileFrom, getConfigFromBase } from "./specl.js";
import type { TCliPorts } from "../ports.js";

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
	if (ports.fs.existsSync(".env")) process.loadEnvFile();
	const parsed = processArgs(args);
	const bases = basesFrom(parsed.params[0]?.replace(/\/$/, ""));
	const configBases = parsed.configLoc ? [parsed.configLoc] : bases;
	const specl = await getSpeclOrExit(configBases, ports);

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
		const policyConfig = resolveRunPolicy(parsed.policyConfig, env, protoOptions, specl, ports.fs);
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
			if (!verification)
				console.info(
					`${OPTION_ONCE}: ${parsed.dryRun ? "a rehearsal" : parsed.statements.length ? "a run of statements" : "a run of features that depends on an untracked directory"} doesn't record a pass against its dependencies, so it runs`,
				);
			// A group whose last run passed where every dependency holds the digest it held then would pass again, so it exits as
			// passed without running. A group whose last run failed runs again, so a person can retry a failure whose cause is
			// outside the sources without changing anything.
			else if (ports.actualities.outcomeAgainst(verification) === RECORDED_STATUS.completed) return verifiedExit(bases);
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
		else if (verification)
			for (const variance of ports.actualities.recordActuality(verification, result, world.runtime.levels)) console.info(`timings: ${ports.actualities.varianceLine(variance)}`);

		await reportAndExit(result, world, protoOptions, ports);
	} catch (error) {
		// A PhaseBailError carries a result to report. Any other error ends the process with exit code 1.
		if (error instanceof PhaseBailError) {
			// An actuality that stopped before its features isn't evidence about the dependency state.
			if (verification) ports.actualities.forgetOutcome(verification);
			if (!world || !protoOptions) {
				const failure = error.result.failure;
				const stage = failure?.stage ?? "?";
				console.error(`\n${CHECK_NO} ${stage} Error: ${failure?.error?.message ?? "unknown"}`);
				if (failure?.error?.details) console.error("Additional details:", failure.error.details);
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
	const allSteppers = formattedSteppers(createSteppers(await steppers(specl.steppers)));
	console.info("Steppers:", JSON.stringify(allSteppers, null, 2));
	console.info(
		"Write each step as the text after its name. Quote a literal for a {placeholder}, or name a variable that a set step or the environment defines.\nStart a prose line with a capital letter and end it with one of [.!?:;]. ",
	);
	process.exit(0);
}

export function resolveRunPolicy(
	cliPolicyConfig: TRunPolicyConfig | undefined,
	env: NodeJS.ProcessEnv,
	protoOptions: TProtoOptions,
	specl: TSpecl,
	fs: Pick<TFileSystem, "readFileSync">,
): TRunPolicyConfig | undefined {
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

		loadAndValidateRunPolicy(policyConfig, specl.runPolicy, fs);
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
		const errorMessage = executorResult.failure?.error?.message || "Unknown error";
		const stage = executorResult.failure?.stage;

		console.error(`\n${CHECK_NO} ${stage ? `${stage} Error: ` : ""}${errorMessage}`);

		if (executorResult.failure?.error?.details) {
			const { ...otherDetails } = executorResult.failure.error.details;
			if (Object.keys(otherDetails).length > 0) {
				console.error("\nAdditional details:", otherDetails);
			}
		}
	}

	if (staysAfterExecution(protoOptions.options[STAY], executorResult.ok)) await ports.clock.wait(1e9);
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
	const statementFeature = withName(bases[0] ?? ".", "statement.feature", statements.join("\n"));
	if (featureFilter) {
		const collected = await features.collect(bases, featureFilter, policyConfig);
		return { features: [...collected.features, statementFeature], backgrounds: collected.backgrounds };
	}
	// A filter that doesn't match a feature collects the base's backgrounds alone. Statements still run against a base
	// that doesn't exist or doesn't hold features or backgrounds. emptyIfNoFeatures rethrows any other collector error.
	const holdsNothing = !fs.existsSync(bases[0] ?? ".");
	const backgrounds = holdsNothing ? [] : (await features.collect(bases, [NO_FEATURE_MATCHES], policyConfig).catch(emptyIfNoFeatures)).backgrounds;
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
