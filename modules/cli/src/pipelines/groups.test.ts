import { describe, expect, it } from "vitest";
import type { TSpecl } from "@haibun/core/lib/actuality.js";
import type { TGroup } from "../domains/groups.js";
import path from "node:path";
import type { TConfigFiles, TGroups } from "../ports.js";
import { foundGroups, groupArgs, runGroups, selectedGroups } from "./groups.js";

/** The configs of a repository by their paths, which a fake reads in place of the files. */
const CONFIGS: Record<string, TSpecl> = {
	"tests/config.json": { steppers: [], group: { bases: [".", "@haibun/shu/waypoints"] } },
	"tests/instance/config.json": { steppers: [] },
	"mail/config.json": { steppers: [], environments: ["imap"], group: { filter: ["inbox"] } },
	"scale/config.json": { steppers: [], group: { set: "scale" } },
	"profile/config.json": { steppers: [], group: { filter: ["a-"], clears: ["capture/profile"] } },
	"profile/config-reopened.json": { steppers: [], group: { filter: ["[b-e]-"], after: ["config.json"] } },
};
const FILES = [...Object.keys(CONFIGS), "tests/features/a.feature", "tsconfig.json"];
const ROOT = process.cwd();
const fromRoot = (at: unknown): string => path.relative(ROOT, String(at));
const unread = (): never => {
	throw new Error("the fake doesn't read directories or packages");
};
/** A file system that holds the configs of the fake repository, by their paths from the working directory. */
const fs: TConfigFiles = {
	existsSync: (at) => FILES.some((file) => file === fromRoot(at) || file.startsWith(`${fromRoot(at)}/`)),
	readFileSync: ((at: unknown) => JSON.stringify(CONFIGS[fromRoot(at)])) as TConfigFiles["readFileSync"],
	readdirSync: unread as TConfigFiles["readdirSync"],
	statSync: unread as TConfigFiles["statSync"],
	packageLocation: unread,
};
const groups = (ran: string[], failing: string[] = []): TGroups => ({
	files: () => FILES,
	run: (group: TGroup, args: string[]) => {
		ran.push([group.config, ...args].join(" "));
		return Promise.resolve(failing.includes(group.config) ? 3 : 0);
	},
});
const found = foundGroups(ROOT, FILES, fs);
const configs = (selected: TGroup[]): string[] => selected.map(({ config }) => config);
const NONE = { set: undefined, environments: [], within: [], filter: [] };
const exists = (at: string) => fs.existsSync(at);

describe("haibun-cli --groups", () => {
	it("finds each config that declares a group, with what it declares and its environments", () => {
		expect(configs(found)).toEqual(["mail/config.json", "profile/config-reopened.json", "profile/config.json", "scale/config.json", "tests/config.json"]);
		expect(found.find(({ config }) => config === "tests/config.json")).toMatchObject({ bases: [".", "@haibun/shu/waypoints"], filter: [], environments: [] });
		expect(found.find(({ config }) => config === "mail/config.json")).toMatchObject({ bases: ["."], filter: ["inbox"], environments: ["imap"] });
		expect(found.find(({ config }) => config === "profile/config-reopened.json")?.after).toEqual(["profile/config.json"]);
	});

	it("selects the groups of the set without environments, and runs a group after each it names", () => {
		expect(configs(selectedGroups(found, NONE))).toEqual(["profile/config.json", "profile/config-reopened.json", "tests/config.json"]);
	});

	it("selects the groups of a named set, and the groups whose environments a call names", () => {
		expect(configs(selectedGroups(found, { ...NONE, set: "scale" }))).toEqual(["scale/config.json"]);
		expect(configs(selectedGroups(found, { ...NONE, environments: ["imap"] }))).toEqual([
			"mail/config.json",
			"profile/config.json",
			"profile/config-reopened.json",
			"tests/config.json",
		]);
	});

	it("narrows to the configs and directories a call names, with each group a narrowed group runs after", () => {
		expect(configs(selectedGroups(found, { ...NONE, within: ["tests"] }))).toEqual(["tests/config.json"]);
		expect(configs(selectedGroups(found, { ...NONE, within: ["profile/config-reopened.json"] }))).toEqual(["profile/config.json", "profile/config-reopened.json"]);
	});

	it("runs a config a call names whatever its set and environments, and reads the configs it names without listing the files", async () => {
		expect(configs(selectedGroups(found, { ...NONE, within: ["scale/config.json", "mail/config.json"] }))).toEqual(["mail/config.json", "scale/config.json"]);
		const ran: string[] = [];
		const unlisted: TGroups = { ...groups(ran), files: () => expect.fail("a call that names configs doesn't list the files") };
		expect(await runGroups(["--groups", "profile/config-reopened.json"], { fs, groups: unlisted })).toBe(0);
		expect(ran).toEqual(["profile/config.json", "profile/config-reopened.json"]);
	});

	it("refuses a group that runs after a config without a group, and groups that run after each other", () => {
		const named = (after: string): TGroup => ({ config: "a/config.json", bases: ["."], filter: [], set: undefined, after: [after], environments: [], clears: [] });
		expect(() => selectedGroups([named("b/config.json")], NONE)).toThrow("runs after b/config.json, which doesn't declare a group");
		const cycle = [named("b/config.json"), { ...named("a/config.json"), config: "b/config.json" }];
		expect(() => selectedGroups(cycle, NONE)).toThrow("in a cycle: a/config.json -> b/config.json -> a/config.json");
	});

	it("runs a feature filter a call gives in place of each group's own", () => {
		expect(selectedGroups(found, { ...NONE, filter: ["agent-"] }).map(({ filter }) => filter)).toEqual([["agent-"], ["agent-"], ["agent-"]]);
	});

	it("reads the selection, a filter and the listing, passes every other option to each run, and refuses a selection without its value", () => {
		expect(groupArgs(["--groups", "--set", "scale", "--environments", "llm,imap", "tests/", "agent-", "--once", "--with-steppers=debugger-stepper"], exists)).toEqual({
			selection: { set: "scale", environments: ["llm", "imap"], within: ["tests"], filter: ["agent-"] },
			list: false,
			forwarded: ["--once", "--with-steppers=debugger-stepper"],
		});
		expect(groupArgs(["--groups", "--list"], exists).list).toBe(true);
		expect(() => groupArgs(["--groups", "--set"], exists)).toThrow("--set doesn't name a value");
	});

	it("runs the selected groups in order with the options, and stops at the first that fails with its code", async () => {
		const ran: string[] = [];
		expect(await runGroups(["--groups", "--once"], { fs, groups: groups(ran, ["profile/config-reopened.json"]) })).toBe(3);
		expect(ran).toEqual(["profile/config.json --once", "profile/config-reopened.json --once"]);
	});
});
