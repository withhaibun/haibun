/**
 * The configuration a run reads: the config file its bases name, with the configuration it extends, read through the file
 * system it is given.
 */
import path from "node:path";
import { namesPackage, SpeclSchema, type TSpecl, type TStepperEntry } from "@haibun/core/lib/actuality.js";
import type { TConfigFiles } from "../ports.js";
import type { TBase } from "@haibun/core/lib/world.js";
import { errorDetail } from "@haibun/core/lib/domains/util.js";
import type { TFileSystem } from "@haibun/core/lib/adapters/workspace-lib.js";

/** The file of a run's starting directory that holds the values of the external environments its configuration declares. */
export const DOTENV = ".env";

/** Returns whether a run reads the .env file of its starting directory: where its configuration declares an external environment,
 *  whose values that file holds. A configuration that doesn't declare one runs the same with or without the file. */
export const readsDotenv = (specl: TSpecl): boolean => specl.environments !== undefined && specl.environments.length > 0;

/** Returns the configuration file a run reads. The first base that is an existing JSON file or a directory that
 *  contains config.json gives that file. The working directory's config.json is the fallback. */
export function configFileFrom(bases: TBase, fs: TFileSystem): string {
	const found = bases?.filter((b) => (b.endsWith("json") && fs.existsSync(b)) || fs.existsSync(`${b}/config.json`));
	const configCandidate = (found && found[0]) || ".";
	return configCandidate.endsWith("json") ? configCandidate : `${configCandidate}/config.json`;
}

const sameEntry = (a: TStepperEntry, b: TStepperEntry): boolean => JSON.stringify(a) === JSON.stringify(b);
/** The keys a config states for itself, which a config that extends it takes only where it states them too. */
const OWN_KEYS: readonly string[] = ["extends", "group"];
const withoutOwnKeys = (specl: TSpecl): TSpecl => Object.fromEntries(Object.entries(specl).filter(([key]) => !OWN_KEYS.includes(key))) as TSpecl;
const withoutExtends = (specl: TSpecl): TSpecl => Object.fromEntries(Object.entries(specl).filter(([key]) => key !== "extends")) as TSpecl;

/** Returns the configuration `own` states with the configuration `base` that it extends. The base's steppers come first, then the
 *  config's own. The other keys the config states replace the base's, apart from the options, module options, parameters and process
 *  environment, which add to the base's, and the group, which a config that states one takes with what it states replacing the base's, and the `dependsOn` paths and environments, which join the base's. A base's `dependsOn` path is read from the
 *  config that extends it, and a dependency named by its package stays as it is named. Throws where the config lists a stepper that
 *  its base lists. */
function extendedSpecl(base: TSpecl, own: TSpecl, ownFile: string, baseFile: string): TSpecl {
	const repeated = own.steppers.filter((added) => base.steppers.some((held) => sameEntry(held, added)));
	if (repeated.length > 0)
		throw new Error(`the configuration ${ownFile} lists ${repeated.map((s) => JSON.stringify(s)).join(", ")}, which its base ${baseFile} lists. Remove them from ${ownFile}.`);
	const fromHere = (dep: string): string => (namesPackage(dep) ? dep : path.relative(path.dirname(ownFile), path.resolve(path.dirname(baseFile), dep)));
	const joined = <T>(held: T[] | undefined, added: T[] | undefined): T[] | undefined =>
		held === undefined ? added : added === undefined ? held : [...new Set([...held, ...added])];
	const merged = {
		...withoutOwnKeys(base),
		...withoutExtends(own),
		steppers: [...base.steppers, ...own.steppers],
		dependsOn: joined(base.dependsOn?.map(fromHere), own.dependsOn),
		environments: joined(base.environments, own.environments),
	};
	for (const key of ["options", "moduleOptions", "appParameters", "env"] as const)
		if (base[key] !== undefined || own[key] !== undefined) Object.assign(merged, { [key]: { ...base[key], ...own[key] } });
	if (own.group !== undefined) Object.assign(merged, { group: { ...base.group, ...own.group } });
	return merged;
}

/** Returns the configuration a file states, with the configuration it extends: a config named by its path from the file, or by a
 *  package's export, such as `@haibun/cli/config.base.json`, which is found from the file's directory as Node finds a package. Throws
 *  where a configuration doesn't read or parse, or where the extends chain returns to a file already in the chain. */
function readSpecl(file: string, fs: TConfigFiles, passed: readonly string[]): TSpecl {
	const at = path.resolve(file);
	if (passed.includes(at)) throw new Error(`the configuration ${file} extends itself through ${[...passed, at].join(" -> ")}. Remove one extends from the chain.`);
	let own: TSpecl;
	try {
		own = SpeclSchema.parse(JSON.parse(fs.readFileSync(file, "utf-8")));
	} catch (e: unknown) {
		throw new Error(`the configuration ${file} doesn't read or parse: ${errorDetail(e)}`);
	}
	if (own.extends === undefined) return own;
	const baseFile = namesPackage(own.extends) ? fs.packageLocation(own.extends, path.dirname(file)) : path.resolve(path.dirname(file), own.extends);
	return extendedSpecl(readSpecl(baseFile, fs, [...passed, at]), own, file, baseFile);
}

/** Returns the configuration the bases name: a JSON config file, or the config.json of a directory. Throws where the bases
 *  name more than one configuration, or where the configuration doesn't read or parse. */
export function getConfigFromBase(bases: TBase, fs: TConfigFiles): TSpecl {
	const found = bases?.filter((b) => (b.endsWith("json") && fs.existsSync(b)) || fs.existsSync(`${b}/config.json`));
	if (found?.length > 1) throw new Error(`the bases name several configurations: ${found.join(", ")}. Name one of them with --config.`);
	const f = configFileFrom(bases, fs);
	return readSpecl(f, fs, []);
}
