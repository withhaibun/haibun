import nodeFS, { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vitest, describe, it, expect } from "vitest";

import { CONTINUE_AFTER_ERROR, DEFAULT_DEST, MODULE_OPTION_PREFIX, STEP_DELAY } from "@haibun/core/lib/domains/protocol.js";

const OTHER_OPTION = `${MODULE_OPTION_PREFIX}TESTSTEPSWITHOPTIONS_OTHER`;
import { HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS, passWithDefaults } from "@haibun/core/lib/test/lib.js";
import TestStepsWithOptions from "@haibun/core/lib/test/TestStepsWithOptions.js";
import { getDefaultOptions } from "@haibun/core/lib/domains/util.js";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";

import { SpeclSchema, type TSpecl } from "@haibun/core/lib/actuality.js";
import type { TProtoOptions } from "@haibun/core/lib/world.js";
import { OPTION_RUN_POLICY, OPTION_DRY_RUN, type TRunPolicyConfig } from "@haibun/core/run-policy/domains/run-policy.js";
import * as lib from "./run-cli.js";
import { getConfigFromBase, readsDotenv } from "./specl.js";
import { processBaseEnvToOptionsAndErrors } from "../domains/base-options.js";
import { cliPorts } from "../root.js";
import { fileSystem } from "../adapters/processes.js";

// Mocks loadAndValidateRunPolicy so a test does not read test-policy.json.
vitest.mock("@haibun/core/run-policy/pipelines/policy-file.js", () => ({ loadAndValidateRunPolicy: vitest.fn() }));

const s = (s: string) => s.split(" ");

const expectExitAndThrow = (expectedCode: number) => (code?: number | string | null) => {
	expect(code).toBe(expectedCode);
	throw new Error(`exit with code ${expectedCode}`);
};

describe("usageThenExit", () => {
	it("exits with success code 0", async () => {
		vitest.spyOn(process, "exit").mockImplementationOnce(expectExitAndThrow(0));
		await expect(lib.usageThenExit({ ...getDefaultOptions(), steppers: [] }, cliPorts().steppers)).rejects.toThrow("exit with code 0");
	});
	it("exits with error code 1", async () => {
		vitest.spyOn(process, "exit").mockImplementationOnce(expectExitAndThrow(1));
		await expect(lib.usageThenExit({ ...getDefaultOptions(), steppers: [] }, cliPorts().steppers, "Test Error Message")).rejects.toThrow("exit with code 1");
	});
});

describe("options", () => {
	it("stepper options", async () => {
		const feature = { path: "/features/test.feature", content: `When I have a stepper option` };
		const protoConfig = { moduleOptions: { [HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS]: "true" }, options: { DEST: DEFAULT_DEST } };
		const result = await passWithDefaults([feature], [TestStepsWithOptions], protoConfig);
		expect(result.ok).toBe(true);
		expect(result.featureResults?.length).toBe(1);
		expect(itemAt(itemAt(result.featureResults ?? [], 0).stepResults, 0).products?.summary).toEqual("options");
	});
});

/** A config that doesn't set an option. */
const NO_CONFIG: TSpecl = { steppers: [] };

describe("processEnv", () => {
	it("takes module options from a base's config, and an environment variable replaces the config's value", () => {
		const specl = SpeclSchema.parse({ steppers: [], moduleOptions: { [HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS]: "from the config", [OTHER_OPTION]: "kept" } });
		const { moduleOptions } = processBaseEnvToOptionsAndErrors({ [HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS]: "from the environment" }, specl);
		expect(moduleOptions).toEqual({ [HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS]: "from the environment", [OTHER_OPTION]: "kept" });
		expect(() => SpeclSchema.parse({ steppers: [], moduleOptions: { EXISTS: "unnamed" } }), "and refuses a module option whose name lacks the module option prefix").toThrow(
			`a module option is named ${MODULE_OPTION_PREFIX}{STEPPER}_{OPTION}`,
		);
	});
	it("assigns boolean true", () => {
		const protoOptions = processBaseEnvToOptionsAndErrors({ [`HAIBUN_${CONTINUE_AFTER_ERROR}`]: "true" }, NO_CONFIG);
		expect(protoOptions.options[CONTINUE_AFTER_ERROR]).toBeDefined();
		expect(protoOptions.options[CONTINUE_AFTER_ERROR]).toBe(true);
	});
	it("assigns boolean false", () => {
		expect(processBaseEnvToOptionsAndErrors({ [`HAIBUN_${CONTINUE_AFTER_ERROR}`]: "false" }, NO_CONFIG).options[CONTINUE_AFTER_ERROR]).toBe(false);
	});
	it("errors for non-boolean value ", () => {
		expect(() => processBaseEnvToOptionsAndErrors({ HAIBUN_TRACE: "wtw" }, NO_CONFIG)).toThrow();
	});
	it("runs once when HAIBUN_ONCE or --once is set, so a script can set HAIBUN_ONCE for every run it chains", () => {
		const { options } = processBaseEnvToOptionsAndErrors({ HAIBUN_ONCE: "true" }, NO_CONFIG);
		expect(lib.runsOnce({ once: false }, options), "the environment alone").toBe(true);
		expect(lib.runsOnce({ once: true }, processBaseEnvToOptionsAndErrors({}, NO_CONFIG).options), "the command line alone").toBe(true);
		expect(lib.runsOnce({ once: false }, processBaseEnvToOptionsAndErrors({}, NO_CONFIG).options), "without either").toBe(false);
		expect(lib.runsOnce({ once: false }, processBaseEnvToOptionsAndErrors({ HAIBUN_ONCE: "false" }, NO_CONFIG).options), "the environment set to false").toBe(false);
		expect(() => processBaseEnvToOptionsAndErrors({ HAIBUN_ONCE: "yes" }, NO_CONFIG), "a value other than true or false").toThrow();
	});
	it("assigns int", () => {
		const { options } = processBaseEnvToOptionsAndErrors({ [`HAIBUN_${STEP_DELAY}`]: "1" }, NO_CONFIG);
		expect(options[STEP_DELAY]).toBe(1);
	});
	it("errors for string passed as int", () => {
		expect(() => processBaseEnvToOptionsAndErrors({ [`HAIBUN_${STEP_DELAY}`]: "x.2" }, NO_CONFIG)).toThrow();
	});
	it("errors for non option", () => {
		expect(() => processBaseEnvToOptionsAndErrors({ HAIBUN_WTW: "x.2" }, NO_CONFIG)).toThrow();
	});
});

const POLICY_BASE = "e2e-tests/policy-test";

describe("collect", () => {
	it("runs the statements as one feature, in the order given", async () => {
		const { features } = await lib.collect(cliPorts(), ["tests"], undefined, ["create graph store", "enable rpc"]);
		expect(features).toHaveLength(1);
		expect(itemAt(features, 0)).toMatchObject({ content: "create graph store\nenable rpc" });
	});
	it("runs the statements against a base that doesn't exist", async () => {
		const { features, backgrounds } = await lib.collect(cliPorts(), ["/nonexistent-base"], undefined, ["create graph store"]);
		expect(itemAt(features, 0).content).toBe("create graph store");
		expect(backgrounds).toEqual([]);
	});
	it("runs the filtered features before the statements, so the statements act on the state the features leave", async () => {
		const { features } = await lib.collect(cliPorts(), [POLICY_BASE], ["health"], ["create graph store"]);
		expect(features.length).toBeGreaterThan(1);
		expect(features.at(-1)?.content, "the statements run after the features").toBe("create graph store");
		expect(
			features.slice(0, -1).every((f) => f.path.includes("health")),
			"and only the features the filter selects run before them",
		).toBe(true);
	});
	it("collects only the filtered features when a statement isn't given", async () => {
		const { features } = await lib.collect(cliPorts(), [POLICY_BASE], ["health"], []);
		expect(features.every((f) => f.path.includes("health"))).toBe(true);
	});
});

describe("processArgs", () => {
	it("finds help", () => {
		const { showHelp } = lib.processArgs(s("--help"));
		expect(showHelp).toBe(true);
	});
	it("specifies config", () => {
		const { configLoc } = lib.processArgs(s("--config boo"));
		expect(configLoc).toBe("boo");
	});
	it("get config as filename", () => {
		const { configLoc } = lib.processArgs(s("--config boo/config.json"));
		expect(configLoc).toBe("boo");
	});
	it("gets help and specifies config", () => {
		const { showHelp, configLoc } = lib.processArgs(s("--config boo --help"));
		expect(configLoc).toBe("boo");
		expect(showHelp).toBe(true);
	});
	it("takes several statements in the order given", () => {
		const { statements } = lib.processArgs(["--statement", "create graph store", "--statement", "enable rpc"]);
		expect(statements).toEqual(["create graph store", "enable rpc"]);
	});
	it("takes a statement joined to the option by an equals sign as one argument", () => {
		const { statements } = lib.processArgs(["--statement=create graph store"]);
		expect(statements).toEqual(["create graph store"]);
	});
	it("refuses a statement option without a value, rather than running an empty feature", () => {
		expect(() => lib.processArgs(["--statement"])).toThrow(/requires a statement/);
	});
	it("gets parameters", () => {
		const { params } = lib.processArgs(s("foo bar"));
		expect(params).toEqual(["foo", "bar"]);
	});
	it("takes --once as an option rather than a base", () => {
		const { once, params } = lib.processArgs(s("--once tests"));
		expect(once).toBe(true);
		expect(params).toEqual(["tests"]);
	});
	it("gets args and parameters", () => {
		const { showHelp, configLoc, params } = lib.processArgs(s("--config boo --help foo bar"));
		expect(params).toEqual(["foo", "bar"]);
		expect(configLoc).toBe("boo");
		expect(showHelp).toBe(true);
	});
	it("parses --run-policy with two args", () => {
		const { policyConfig, params } = lib.processArgs(s(`${OPTION_RUN_POLICY} prod smoke:r,api:a foo`));
		expect(policyConfig).toBeDefined();
		const config = policyConfig as NonNullable<typeof policyConfig>;
		expect(config.place).toBe("prod");
		expect(config.dirFilters).toEqual([
			{ dir: "smoke", access: "r" },
			{ dir: "api", access: "a" },
		]);
		expect(params).toEqual(["foo"]);
	});
	it(`returns undefined policyConfig when ${OPTION_RUN_POLICY} not specified`, () => {
		const { policyConfig } = lib.processArgs(s("foo"));
		expect(policyConfig).toBeUndefined();
	});
	it("parses --dry-run flag", () => {
		const { dryRun, policyConfig } = lib.processArgs(s(`${OPTION_DRY_RUN} ${OPTION_RUN_POLICY} prod smoke:r foo`));
		expect(dryRun).toBe(true);
		expect(policyConfig).toBeDefined();
	});
	it("returns dryRun false by default", () => {
		const { dryRun } = lib.processArgs(s("foo"));
		expect(dryRun).toBe(false);
	});
});

describe("runCli", () => {
	it("runs with --show-steppers", async () => {
		vitest.spyOn(process, "exit").mockImplementationOnce(expectExitAndThrow(0));
		await expect(lib.runCli(s("--config modules/cli/test --show-steppers"), {}, cliPorts())).rejects.toThrow("exit with code 0");
	});
	it("fails without a config", async () => {
		vitest.spyOn(process, "exit").mockImplementationOnce(expectExitAndThrow(1));
		await expect(lib.runCli(s("--config nowhere/noway"), {}, cliPorts())).rejects.toThrow("exit with code 1");
	});
	it("runs a basic test", async () => {
		vitest.spyOn(process, "exit").mockImplementationOnce(expectExitAndThrow(0));
		await expect(() => lib.runCli(s("--config modules/cli/test modules/cli/test/tests"), {}, cliPorts())).rejects.toThrow("exit with code 0");
	});
	it("runs a kireji test with backgrounds and features", async () => {
		vitest.spyOn(process, "exit").mockImplementationOnce(expectExitAndThrow(0));
		await expect(lib.runCli(s("--config modules/cli/test/kireji modules/cli/test/kireji"), {}, cliPorts())).rejects.toThrow("exit with code 0");
	});

	it("runs a kireji test with outcomes", async () => {
		vitest.spyOn(process, "exit").mockImplementationOnce(expectExitAndThrow(0));
		await expect(lib.runCli(s("--config modules/cli/test/kireji-outcomes modules/cli/test/kireji-outcomes"), {}, cliPorts())).rejects.toThrow("exit with code 0");
	});
});

describe("resolveRunPolicy", () => {
	it("injects appParameters into protoOptions.options.envVariables", () => {
		const protoOptions = { options: { envVariables: {} }, moduleOptions: {} } as TProtoOptions;
		const specl = { steppers: [], runPolicy: "test-policy.json", appParameters: { prod: { API_KEY: "secret-123", TIMEOUT: "5000" } } } as TSpecl;
		const policyConfig = { place: "prod", dirFilters: [] } as TRunPolicyConfig;

		lib.resolveRunPolicy(policyConfig, {}, protoOptions, specl, nodeFS);

		expect(protoOptions.options.envVariables?.API_KEY).toBe("secret-123");
		expect(protoOptions.options.envVariables?.TIMEOUT).toBe("5000");
	});
});

describe("runBases", () => {
	it("names a base by its path, or by a package's export, which it finds from the working directory", () => {
		expect(lib.runBases("tests,@haibun/shu/waypoints/", fileSystem)).toEqual(["tests", join(process.cwd(), "node_modules/@haibun/shu/waypoints")]);
	});
});

describe("getConfigFromBase with extends", () => {
	const BASE = {
		steppers: ["variables-stepper", "haibun-stepper"],
		options: { DEST: "base" },
		moduleOptions: { [OTHER_OPTION]: "base" },
		environments: ["model"],
		dependsOn: ["shared"],
	};
	/** A directory holding the base config in its parent folder and the given config beside its own folder. */
	const group = (own: Record<string, unknown>): string => {
		const root = mkdtempSync(join(tmpdir(), "extends-"));
		mkdirSync(join(root, "shared"));
		mkdirSync(join(root, "group"));
		writeFileSync(join(root, "base.json"), JSON.stringify(BASE));
		writeFileSync(join(root, "group", "config.json"), JSON.stringify(own));
		return join(root, "group");
	};

	it("adds the config's steppers after the base's, and lets the config's keys replace the base's", () => {
		const specl = getConfigFromBase(
			[group({ extends: "../base.json", steppers: ["logic-stepper"], options: { DEST: "own" }, moduleOptions: { [`${OTHER_OPTION}2`]: "own" } })],
			fileSystem,
		);
		expect(specl.steppers).toEqual(["variables-stepper", "haibun-stepper", "logic-stepper"]);
		expect(specl.options).toEqual({ DEST: "own" });
		expect(specl.moduleOptions).toEqual({ [OTHER_OPTION]: "base", [`${OTHER_OPTION}2`]: "own" });
		expect(specl).not.toHaveProperty("extends");
	});

	it("reads a base's dependsOn path from the config that extends it, and joins the environments", () => {
		const specl = getConfigFromBase([group({ extends: "../base.json", steppers: [], environments: ["mail"] })], fileSystem);
		expect(specl.dependsOn).toEqual(["../shared"]);
		expect(specl.environments).toEqual(["model", "mail"]);
	});

	it("reads the .env file of a run's directory only where the config or its base declares an environment", () => {
		expect(readsDotenv(getConfigFromBase([group({ extends: "../base.json", steppers: [] })], fileSystem))).toBe(true);
		expect(readsDotenv(NO_CONFIG)).toBe(false);
	});

	it("refuses a stepper the base lists", () => {
		expect(() => getConfigFromBase([group({ extends: "../base.json", steppers: ["haibun-stepper"] })], fileSystem)).toThrow(
			/lists "haibun-stepper", which its base .*base\.json lists\. Remove them from/,
		);
	});

	it("extends a config named by its package's export, which it finds from its own directory", () => {
		const dir = group({ extends: "@haibun/cli/config.base.json", steppers: ["activities-stepper"] });
		mkdirSync(join(dir, "node_modules", "@haibun"), { recursive: true });
		symlinkSync(join(import.meta.dirname, "..", ".."), join(dir, "node_modules", "@haibun", "cli"));
		expect(getConfigFromBase([dir], fileSystem).steppers).toEqual([
			"variables-stepper",
			"resources-stepper",
			"@haibun/logic/logic-stepper",
			"haibun-stepper",
			"activities-stepper",
		]);
	});

	it("refuses a config that extends itself", () => {
		expect(() => getConfigFromBase([group({ extends: "config.json", steppers: [] })], fileSystem)).toThrow(/extends itself through/);
	});
});
