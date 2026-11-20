/**
 * The one way groups of features are found, selected and run. A group is a config that declares `group`. `haibun-cli --groups` finds
 * each such config among the files of the working directory's repository, selects the groups of the set `--set` names whose external
 * environments `--environments` names, narrowed to the configs or directories its paths name, orders them after the groups each names
 * in `after`, and runs each from its config's directory, one after another, stopping at the first that fails. A word that isn't a path
 * is the feature filter each group runs, every other option the command line gives reaches each group's run, and `--list` prints the
 * selected configs instead of running them.
 */
import path from "node:path";
import { errorDetail } from "@haibun/core/lib/domains/util.js";
import { CONFIG_FILE, GROUP_OPTIONS, type TGroup, type TGroupSelection } from "../domains/groups.js";
import { CLI, columns, terms, type THelpEntry } from "../domains/help.js";
import type { TCliPorts, TConfigFiles } from "../ports.js";
import { DOTENV, getConfigFromBase } from "./specl.js";

/** What each option and word of a command that runs groups takes and does, which its help states. */
const GROUP_HELP: readonly THelpEntry[] = [
	{ name: `${GROUP_OPTIONS.set} set`, does: `runs the groups whose config states this set as "group.set", in place of the groups that don't state one` },
	{
		name: `${GROUP_OPTIONS.environments} name[,name]`,
		does: `names the external services this machine reaches, such as a model or a mail server. An environment is a name, which a config lists under "environments" for each service its features use. A group runs where the command names each of its environments, and reads their values from the ${DOTENV} file beside its config`,
	},
	{ name: GROUP_OPTIONS.list, does: "prints the selected configs in place of running them" },
	{ name: GROUP_OPTIONS.help, does: "prints this" },
	{
		name: "config or directory",
		does: "narrows the selection to that config, or to the configs under that directory. A config named itself runs whatever its set and environments",
	},
	{ name: "filter", does: "a word that isn't a path: the features each group runs, in place of its own filter" },
	{ name: "option", does: "each other option reaches each group's run" },
];

/** The selection, the listing and the options a command line that runs groups gives: each argument after `--groups` that isn't a
 *  selection or the listing reaches each group's run where it is an option, narrows the selection where it is a path, and is the
 *  feature filter each group runs where it is another word. */
export function groupArgs(args: readonly string[], exists: (at: string) => boolean): { selection: TGroupSelection; list: boolean; help: boolean; forwarded: string[] } {
	const selection: TGroupSelection = { set: undefined, environments: [], within: [], filter: [] };
	const forwarded: string[] = [];
	let list = false;
	let help = false;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		const value = (): string => {
			const given = args[++i];
			if (given === undefined || given.startsWith("-")) throw new Error(`${arg} takes a value: ${GROUP_HELP.find(({ name }) => name.startsWith(`${arg} `))?.name}`);
			return given;
		};
		if (arg === GROUP_OPTIONS.groups) continue;
		if (arg === GROUP_OPTIONS.set) selection.set = value();
		else if (arg === GROUP_OPTIONS.environments) selection.environments = value().split(",");
		else if (arg === GROUP_OPTIONS.list) list = true;
		else if (arg === GROUP_OPTIONS.help || arg === "-h") help = true;
		else if (arg?.startsWith("-")) forwarded.push(arg);
		else if (arg !== undefined) {
			const at = path.normalize(arg).replace(/\/$/, "");
			if (exists(at)) selection.within.push(at);
			else selection.filter.push(arg);
		}
	}
	return { selection, list, help, forwarded };
}

/** What a command line that runs groups gives, or why it is refused where an option doesn't take what follows it. */
function argsOrRefusal(args: readonly string[], exists: (at: string) => boolean): ReturnType<typeof groupArgs> | string {
	try {
		return groupArgs(args, exists);
	} catch (e) {
		return errorDetail(e);
	}
}

/** Each group among `files`, the paths of a repository's files from its root: a config that declares `group`, read with the config it
 *  extends, by its path from the root. */
export function foundGroups(root: string, files: readonly string[], fs: TConfigFiles): TGroup[] {
	const declares = (config: string): boolean => Object.hasOwn(JSON.parse(String(fs.readFileSync(path.join(root, config), "utf-8"))), "group");
	return files
		.filter((file) => CONFIG_FILE.test(path.basename(file)) && declares(file))
		.sort()
		.map((config) => {
			const specl = getConfigFromBase([path.join(root, config)], fs);
			const group = specl.group;
			if (group === undefined) throw new Error(`${config} declares a group that its read doesn't hold. Correct its group.`);
			const fromConfig = (at: string): string => path.normalize(path.join(path.dirname(config), at));
			return {
				config,
				bases: group.bases === undefined ? ["."] : group.bases,
				filter: group.filter === undefined ? [] : group.filter,
				set: group.set,
				after: group.after === undefined ? [] : group.after.map(fromConfig),
				environments: specl.environments === undefined ? [] : specl.environments,
				clears: group.clears === undefined ? [] : group.clears,
			};
		});
}

/** Whether each path a selection gives names a config, so the groups it runs are those configs and the groups they run after, which
 *  are read without listing the repository's files. */
const namesConfigs = ({ within: named }: TGroupSelection): boolean => named.length > 0 && named.every((at) => CONFIG_FILE.test(path.basename(at)));

/** The configs, with each config a group among them names in `after`, and each one those name, by their paths from the root. */
function withBefore(root: string, configs: readonly string[], fs: TConfigFiles): string[] {
	const held = new Set(configs);
	for (let added = [...configs]; added.length > 0; ) {
		added = foundGroups(root, added, fs)
			.flatMap(({ after }) => after)
			.filter((before) => !held.has(before));
		for (const before of added) held.add(before);
	}
	return [...held];
}

/** Whether a path is a config or a directory that holds it. */
const within = (config: string, at: string): boolean => config === at || at === "." || config.startsWith(`${at}/`);

/** What a group needs of a command that `selection` doesn't give, as the command line states each: the group's set, and its
 *  environments where the selection doesn't name each of them. A selection selects a group where this list is empty. */
export function needs(group: TGroup, selection: TGroupSelection): string[] {
	const set = group.set === selection.set ? [] : [group.set === undefined ? `a command without ${GROUP_OPTIONS.set}` : `${GROUP_OPTIONS.set} ${group.set}`];
	const named = group.environments.every((environment) => selection.environments.includes(environment));
	return [...set, ...(named ? [] : [`${GROUP_OPTIONS.environments} ${group.environments.join(",")}`])];
}

/** The groups a selection runs, in the order they run: each config a path it gives names, whatever its set and environments, and each
 *  group of the set it names whose environments it names, narrowed to the paths it gives, with each group these name in `after`, each after the groups it names and otherwise by its config's path, and each with
 *  the selection's feature filter where it gives one. Throws where a
 *  group names a config that isn't a group, or where groups name each other in a cycle. */
export function selectedGroups(groups: readonly TGroup[], selection: TGroupSelection): TGroup[] {
	const byConfig = new Map(groups.map((group) => [group.config, group]));
	for (const group of groups)
		for (const before of group.after)
			if (!byConfig.has(before)) throw new Error(`${group.config} runs after ${before}, which doesn't declare a group. Name a config that declares one.`);
	const chosen = groups.filter(
		(group) =>
			selection.within.includes(group.config) ||
			(needs(group, selection).length === 0 && (selection.within.length === 0 || selection.within.some((at) => within(group.config, at)))),
	);
	const ordered: TGroup[] = [];
	const visit = (group: TGroup, through: readonly string[]): void => {
		if (ordered.includes(group)) return;
		if (through.includes(group.config)) throw new Error(`the groups run after each other in a cycle: ${[...through, group.config].join(" -> ")}. Remove one after.`);
		for (const before of group.after) {
			const named = byConfig.get(before);
			if (named !== undefined) visit(named, [...through, group.config]);
		}
		ordered.push(group);
	};
	for (const group of chosen) visit(group, []);
	return selection.filter.length === 0 ? ordered : ordered.map((group) => ({ ...group, filter: selection.filter }));
}

/** Why `selection` doesn't select a group of `found`: each group within its paths with what it needs of the command, as `needs` states. */
export function unselectedGroups(found: readonly TGroup[], selection: TGroupSelection): string {
	const candidates = found.filter(({ config }) => selection.within.length === 0 || selection.within.some((at) => within(config, at)));
	if (candidates.length === 0) return `groups: ${selection.within.length === 0 ? "the repository" : selection.within.join(", ")} doesn't hold a group`;
	return candidates.map((group) => `groups: ${group.config} needs ${needs(group, selection).join(" and ")}`).join("\n");
}

/** A selection that doesn't name a set or an environment, so a group needs of it all that the group states. */
const BARE: TGroupSelection = { set: undefined, environments: [], within: [], filter: [] };

/** The help of a command that runs groups: its options, and each group of `groups` with what it needs of the command and the file
 *  that holds its environments' values, whose presence `holds` reads. */
export function groupsHelp(groups: readonly TGroup[], holds: (at: string) => boolean): string {
	const values = (group: TGroup): string => {
		if (group.environments.length === 0) return "";
		const at = path.join(path.dirname(group.config), DOTENV);
		return holds(at) ? at : `${at} (isn't written yet)`;
	};
	return [
		`usage: ${CLI} ${GROUP_OPTIONS.groups} ${terms(GROUP_HELP)}`,
		"",
		`Runs each selected group of features, one after another. A group is a config that declares "group".`,
		"",
		...columns(GROUP_HELP.map(({ name, does }) => [name, does])),
		"",
		`The groups of this repository, each with what it needs of the command and the ${DOTENV} file of its environments' values:`,
		...columns(groups.map((group) => [group.config, needs(group, BARE).join(" "), values(group)])),
		"",
		`${CLI} directory ${GROUP_OPTIONS.help} lists the variables the steppers of that directory's config read.`,
		"",
	].join("\n");
}

/** Runs the groups of the working directory's repository that the command line selects, one after another, and returns the exit code
 *  of the first that fails, or 0 where each passes. */
export async function runGroups(args: readonly string[], { fs, groups: repository }: Pick<TCliPorts, "fs" | "groups">): Promise<number> {
	const root = process.cwd();
	const holds = (at: string): boolean => fs.existsSync(path.join(root, at));
	const parsed = argsOrRefusal(args, holds);
	if (typeof parsed === "string") {
		console.error(`groups: ${parsed}`);
		return 1;
	}
	const { selection, list, help, forwarded } = parsed;
	if (help) {
		console.info(groupsHelp(foundGroups(root, repository.files(), fs), holds));
		return 0;
	}
	const found = foundGroups(root, namesConfigs(selection) ? withBefore(root, selection.within, fs) : repository.files(), fs);
	const declared = [...new Set(found.flatMap(({ environments }) => environments))].sort();
	const undeclared = selection.environments.filter((environment) => !declared.includes(environment));
	if (undeclared.length > 0 && !namesConfigs(selection)) {
		console.error(`groups: a config here doesn't declare the environment ${undeclared.join(", ")}. The configs declare: ${declared.join(", ")}`);
		return 1;
	}
	const groups = selectedGroups(found, selection);
	if (list) {
		console.info(JSON.stringify(groups.map(({ config }) => config)));
		return 0;
	}
	if (groups.length === 0) {
		console.error(`${unselectedGroups(found, selection)}\ngroups: ${CLI} ${GROUP_OPTIONS.groups} ${GROUP_OPTIONS.help} states what an environment is and lists each group`);
		return 1;
	}
	for (const group of groups) {
		console.info(`\ngroups: ${group.config}`);
		const code = await repository.run(group, forwarded);
		if (code !== 0) {
			console.error(`\ngroups: ${group.config} ended with ${code}. Fix it, then run: ${CLI} ${GROUP_OPTIONS.groups} ${group.config}`);
			return code;
		}
	}
	console.info(`\ngroups: each of ${groups.length} groups passed.`);
	return 0;
}
