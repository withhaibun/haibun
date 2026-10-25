/** The directories of this repository that the code checks read, by their paths from the repository root. */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { sourceDirectoryOf, workspacePackages } from "@haibun/core/lib/test/repository-files.js";

export const REPOSITORY = join(import.meta.dirname, "..");
const MODULES = "modules";
/** A module's feature directories: its test groups, and the backgrounds of the waypoints it holds for other groups. */
const FEATURES = /^(tests|waypoints)/;

const directoriesIn = (path: string): string[] =>
	readdirSync(join(REPOSITORY, path), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
const modules = directoriesIn(MODULES);

/** Each module's package by its name, through which one module imports another. */
export const MODULE_PACKAGES = workspacePackages(REPOSITORY, MODULES);
/** Each module's source directory. */
export const MODULE_SOURCES = Object.values(MODULE_PACKAGES).map(sourceDirectoryOf).sort();
/** Each module's library of waypoints, whose backgrounds build features for other groups. */
export const MODULE_WAYPOINTS = modules.filter((name) => directoriesIn(join(MODULES, name)).includes("waypoints")).map((name) => `${MODULES}/${name}/waypoints`);
/** What the prose check reads: each module's source and feature directories, the end-to-end tests, the documents and the scripts. */
export const PROSE_ROOTS = [
	...MODULE_SOURCES,
	...modules.flatMap((name) =>
		directoriesIn(join(MODULES, name))
			.filter((entry) => FEATURES.test(entry))
			.map((entry) => `${MODULES}/${name}/${entry}`),
	),
	"e2e-tests",
	"docs",
	"scripts",
];
