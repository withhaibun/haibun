/**
 * The one way groups of features are found, selected and run. A group is a config that declares `group`. `haibun-cli --groups` finds
 * each such config among the files of the working directory's repository, selects the groups of the set `--set` names whose external
 * environments `--environments` names, narrowed to the configs or directories its paths name, orders them after the groups each names
 * in `after`, and runs each from its config's directory, one after another, stopping at the first that fails. A word that isn't a path
 * is the feature filter each group runs, every other option the command line gives reaches each group's run, and `--list` prints the
 * selected configs instead of running them.
 */
import path from "node:path";
import { CONFIG_FILE, GROUP_OPTIONS, type TGroup, type TGroupSelection } from "../domains/groups.js";
import type { TCliPorts, TConfigFiles } from "../ports.js";
import { getConfigFromBase } from "./specl.js";

/** The selection, the listing and the options a command line that runs groups gives: each argument after `--groups` that isn't a
 *  selection or the listing reaches each group's run where it is an option, narrows the selection where it is a path, and is the
 *  feature filter each group runs where it is another word. */
export function groupArgs(args: readonly string[], exists: (at: string) => boolean): { selection: TGroupSelection; list: boolean; forwarded: string[] } {
	const selection: TGroupSelection = { set: undefined, environments: [], within: [], filter: [] };
	const forwarded: string[] = [];
	let list = false;
	const rest = args.filter((arg) => arg !== GROUP_OPTIONS.groups);
	for (let i = 0; i < rest.length; i++) {
		const arg = rest[i];
		const value = (): string => {
			const given = rest[++i];
			if (given === undefined || given.startsWith("-")) throw new Error(`${arg} doesn't name a value. Write ${arg} and its value, such as ${arg} scale.`);
			return given;
		};
		if (arg === GROUP_OPTIONS.set) selection.set = value();
		else if (arg === GROUP_OPTIONS.environments) selection.environments = value().split(",");
		else if (arg === GROUP_OPTIONS.list) list = true;
		else if (arg?.startsWith("-")) forwarded.push(arg);
		else if (arg !== undefined) {
			const at = path.normalize(arg).replace(/\/$/, "");
			if (exists(at)) selection.within.push(at);
			else selection.filter.push(arg);
		}
	}
	return { selection, list, forwarded };
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
			(group.set === selection.set &&
				group.environments.every((environment) => selection.environments.includes(environment)) &&
				(selection.within.length === 0 || selection.within.some((at) => within(group.config, at)))),
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

/** Runs the groups of the working directory's repository that the command line selects, one after another, and returns the exit code
 *  of the first that fails, or 0 where each passes. */
export async function runGroups(args: readonly string[], { fs, groups: repository }: Pick<TCliPorts, "fs" | "groups">): Promise<number> {
	const root = process.cwd();
	const { selection, list, forwarded } = groupArgs(args, (at) => fs.existsSync(path.join(root, at)));
	const groups = selectedGroups(foundGroups(root, namesConfigs(selection) ? withBefore(root, selection.within, fs) : repository.files(), fs), selection);
	if (list) {
		console.info(JSON.stringify(groups.map(({ config }) => config)));
		return 0;
	}
	if (groups.length === 0) {
		const set = selection.set === undefined ? `that runs without ${GROUP_OPTIONS.set}` : selection.set;
		const environments = selection.environments.length === 0 ? "none" : selection.environments.join(", ");
		console.error(`groups: the set ${set} doesn't hold a group with the environments ${environments}. Name a set or the environments of a group.`);
		return 1;
	}
	for (const group of groups) {
		console.info(`\ngroups: ${group.config}`);
		const code = await repository.run(group, forwarded);
		if (code !== 0) {
			console.error(`\ngroups: ${group.config} ended with ${code}. Fix it, then run: haibun-cli ${GROUP_OPTIONS.groups} ${group.config}`);
			return code;
		}
	}
	console.info(`\ngroups: each of ${groups.length} groups passed.`);
	return 0;
}
