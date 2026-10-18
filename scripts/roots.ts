/** The directories of this repository that the code checks read, by their paths from the repository root. */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { sourceDirectoryOf, workspacePackages } from "@haibun/core/lib/test/repository-files.js";

export const REPOSITORY = join(import.meta.dirname, "..");
const MODULES = "modules";
const FEATURES = /^tests/;

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
