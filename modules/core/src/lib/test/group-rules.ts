/**
 * Rules for the test groups of a repository and for its first-read documents. A group states its options in its config's
 * `moduleOptions`, and its script calls `haibun-cli` without any. A group names what it uses by its package rather than by a
 * parent path or a link. A first-read document names only paths that exist. A group's actualities file and every baseline are
 * tracked, so each commit holds the measurements of the code it holds.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { z } from "zod";
import { itemAt } from "../domains/item-at.js";
import type { TFound } from "./baseline.js";
import { TEST_MODULE } from "./repository-files.js";
import { ACTUALITIES_FILE } from "../adapters/dependency-state.js";

const HAIBUN_CLI = /\bhaibun-cli\b/;
const MODULE_OPTION_ASSIGNMENT = /\bHAIBUN_O_[A-Z0-9_]+(?==)/g;
const PackageScriptsSchema = z.object({ scripts: z.record(z.string(), z.string()).optional() });
/** A markdown link's target, and a file path in backticks. */
const MARKDOWN_LINK = /\]\(([^)\s]+)\)/g;
const QUOTED_PATH = /`((?:\.{1,2}\/)?[\w-]+(?:\/[\w.-]+)+\.(?:md|json|mjs|sh|feature|ts|yml))`/g;
const NOT_A_PATH = /^(?:[a-z][a-z0-9+.-]*:|#|\/)/i;
const GENERATED = /(?:^|\/)(?:build|build-local|node_modules|capture)\//;
/** A string of a JSON file that names a path through a parent directory. */
const PARENT_PATH = /"([^"]*\.\.\/[^"]*)"/g;
/** The mode git records for a symbolic link. */
const LINK_MODE = "120000";
/** A kireji feature or background of a group or a service, and a package's code, which a feature names by its package. */
const FEATURE_SOURCE = /\.feature\.ts$|\/(features|backgrounds)\/[^/]+\.ts$/;
const PACKAGE_CODE = /(^|\/)(src|build)\//;
const IMPORTED = /\bfrom\s+["']([^"']+)["']/g;
/** A config of a group, which lists the steppers it loads and the external environments its features use. */
const GroupConfigSchema = z.object({ steppers: z.array(z.unknown()), environments: z.array(z.string()).optional() });
/** The arguments of each `haibun-cli` call of a script, up to the shell operator that ends the call. */
const HAIBUN_CLI_CALL = /\bhaibun-cli\s+([^&|;]*)/g;
const CONFIG_FLAGS = ["-c", "--config"];
/** A script that runs a test group: a script whose name begins with `test`, or one that such a script runs. */
const TEST_SCRIPT = /^test/;
const NPM_RUN = /\bnpm run ([\w:.-]+)/g;
/** A baseline that a rule test reads, a long-term tracking file beside a group's actualities file. */
const BASELINE = ":(glob)**/*.baseline.json";

/** The files git tracks in a repository that match a pattern, by their paths from the repository root. */
export const trackedFiles = (repository: string, pattern: string): string[] =>
	execFileSync("git", ["ls-files", "--", pattern], { cwd: repository, encoding: "utf-8" }).split("\n").filter(Boolean);

/** Each `HAIBUN_O_` option that a script of one of the group package.json files, by their paths from the repository root, states
 *  before a `haibun-cli` call. */
export function moduleOptionAssignments(repository: string, groupPackages: readonly string[]): TFound[] {
	return groupPackages.flatMap((file) =>
		Object.entries(PackageScriptsSchema.parse(JSON.parse(readFileSync(join(repository, file), "utf-8"))).scripts ?? {})
			.filter(([, script]) => HAIBUN_CLI.test(script))
			.flatMap(([name, script]) => (script.match(MODULE_OPTION_ASSIGNMENT) ?? []).map((option) => ({ file, finding: `script ${name} states ${option}` }))),
	);
}

/** Each symbolic link a repository commits, each parent path that a group's config names, each script of a package.json that
 *  names a parent path, and each import by a parent path of a package's code from a group's or a service's feature. A group names a
 *  stepper, a base config, a waypoint base, a dependency and the code its features import by its package, and a script calls
 *  `haibun-cli`, which npm puts on the path, so the group runs the same wherever the repository is checked out. */
export function linksAndParentPaths(repository: string): TFound[] {
	const links = execFileSync("git", ["ls-files", "-s"], { cwd: repository, encoding: "utf-8" })
		.split("\n")
		.filter((line) => line.startsWith(`${LINK_MODE} `))
		.map((line) => ({ file: itemAt(line.split("\t"), 1), finding: "is a symbolic link, which a checkout elsewhere doesn't resolve" }));
	const configs = trackedFiles(repository, ":(glob)**/config*.json").flatMap((file) => {
		const text = readFileSync(join(repository, file), "utf-8");
		if (!GroupConfigSchema.safeParse(JSON.parse(text)).success) return [];
		return [...text.matchAll(PARENT_PATH)].map((m) => ({ file, finding: `names ${itemAt(m, 1)}, a parent path` }));
	});
	const scripts = trackedFiles(repository, "*package.json").flatMap((file) =>
		Object.entries(PackageScriptsSchema.parse(JSON.parse(readFileSync(join(repository, file), "utf-8"))).scripts ?? {})
			.filter(([, script]) => script.includes("../"))
			.map(([name]) => ({ file, finding: `script ${name} names a parent path` })),
	);
	const imports = trackedFiles(repository, "*.ts")
		.filter((file) => FEATURE_SOURCE.test(file) && !PACKAGE_CODE.test(file) && !TEST_MODULE.test(file))
		.flatMap((file) =>
			[...readFileSync(join(repository, file), "utf-8").matchAll(IMPORTED)]
				.map((m) => itemAt(m, 1))
				.filter((specifier) => specifier.startsWith("../") && PACKAGE_CODE.test(normalize(join(dirname(file), specifier))))
				.map((specifier) => ({ file, finding: `imports ${specifier}, a package's code, by a parent path` })),
		);
	return [...links, ...configs, ...scripts, ...imports];
}

/** Each `haibun-cli` call of a script: the bases it names, its own base first and each waypoint library after it, and the config it
 *  reads, the one `-c` or `--config` names or the first base's config.json, each by its path from the script's package directory.
 *  Throws for a call that doesn't name a base. */
export function haibunCliCalls(script: string): { bases: string[]; config: string }[] {
	return [...script.matchAll(HAIBUN_CLI_CALL)].map((call) => {
		const words = itemAt(call, 1).split(/\s+/).filter(Boolean);
		const flag = words.findIndex((word) => CONFIG_FLAGS.includes(word));
		const bases = words.find((word, i) => !word.startsWith("-") && (flag === -1 || i !== flag + 1))?.split(",");
		if (bases === undefined) throw new Error(`a haibun-cli call doesn't name a base: ${script}. Name the group's base after its options.`);
		return { bases, config: normalize(flag === -1 ? join(itemAt(bases, 0), "config.json") : itemAt(words, flag + 1)) };
	});
}

/** The directory of each config that a test script of the package.json files, by their paths from the repository root, reads through
 *  `haibun-cli`, by its path from the repository root. A test script is one whose name begins with `test`, or one it runs. */
export function testGroupDirectories(repository: string, packageFiles: readonly string[]): string[] {
	const found = packageFiles.flatMap((file) => {
		const scripts = PackageScriptsSchema.parse(JSON.parse(readFileSync(join(repository, file), "utf-8"))).scripts ?? {};
		const ran = new Set(Object.keys(scripts).filter((name) => TEST_SCRIPT.test(name)));
		for (const name of ran) for (const m of (scripts[name] ?? "").matchAll(NPM_RUN)) if (scripts[itemAt(m, 1)] !== undefined) ran.add(itemAt(m, 1));
		return [...ran].flatMap((name) => haibunCliCalls(scripts[name] ?? "").map(({ config }) => dirname(join(dirname(file), config))));
	});
	return [...new Set(found)].sort();
}

/** The paths of `files` that a .gitignore entry of the repository ignores, whether or not git tracks them. */
function ignoredOf(repository: string, files: readonly string[]): Set<string> {
	const checked = spawnSync("git", ["check-ignore", "--no-index", "--stdin"], { cwd: repository, input: files.join("\n"), encoding: "utf-8" });
	if (checked.status !== 0 && checked.status !== 1) throw new Error(`git check-ignore failed in ${repository}: ${checked.stderr}. Check that git runs there.`);
	return new Set(checked.stdout.split("\n").filter(Boolean));
}

/**
 * Each long-term tracking file that a repository doesn't hold with its version. Every group directory, by its path from the repository
 * root, and every directory under it that holds a group's config, such as an instance a feature launches, holds its actualities file
 * tracked, since a commit holds the durations and outcomes of the code it measures. A config that declares an environment runs
 * where that environment is, which commits its actualities file from there. A baseline is tracked. A .gitignore entry doesn't
 * ignore either, since a later run would write a file git leaves out.
 */
export function untrackedRecords(repository: string, groupDirectories: readonly string[]): TFound[] {
	const tracked = new Set(trackedFiles(repository, "."));
	const nested = groupDirectories.flatMap((dir) =>
		trackedFiles(repository, `:(glob)${dir}/**/config*.json`)
			.filter((file) => {
				const config = GroupConfigSchema.safeParse(JSON.parse(readFileSync(join(repository, file), "utf-8")));
				return config.success && !config.data.environments?.length;
			})
			.map(dirname),
	);
	const records = [...new Set([...groupDirectories, ...nested])].sort().map((dir) => join(dir, ACTUALITIES_FILE));
	const baselines = execFileSync("git", ["ls-files", "--cached", "--others", "--", BASELINE], { cwd: repository, encoding: "utf-8" }).split("\n").filter(Boolean);
	const ignored = ignoredOf(repository, [...records, ...baselines]);
	return [...records, ...baselines].flatMap((file) => [
		...(tracked.has(file) ? [] : [{ file, finding: "isn't tracked: run its group, or its rule test, and commit the file with the code it measures" }]),
		...(ignored.has(file) ? [{ file, finding: "is ignored by a .gitignore entry: remove the entry, so a commit holds the file" }] : []),
	]);
}

/** Each relative link and each quoted path of the markdown documents, by their paths from the repository root, that names a path
 *  absent from the repository. A path resolves from its document or from the repository root. */
export function brokenPaths(repository: string, documents: readonly string[]): TFound[] {
	return documents.flatMap((document) => {
		const text = readFileSync(join(repository, document), "utf-8");
		const named = [...text.matchAll(MARKDOWN_LINK)].map((m) => itemAt(m, 1)).filter((target) => !NOT_A_PATH.test(target));
		const quoted = [...text.matchAll(QUOTED_PATH)].map((m) => itemAt(m, 1)).filter((target) => !GENERATED.test(target));
		return [...named, ...quoted]
			.map((target) => target.replace(/#.*/, ""))
			.filter((target) => target !== "")
			.filter((target) => !existsSync(resolve(repository, dirname(document), target)) && !existsSync(resolve(repository, target)))
			.map((target) => ({ file: document, finding: `names ${target}, which the repository doesn't hold` }));
	});
}
