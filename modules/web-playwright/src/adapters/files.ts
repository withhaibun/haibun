/** The files a step reads and leaves: a path resolved from the working directory, an extension's manifest, and a download removed. */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { TFiles } from "../ports.js";

const MANIFEST = "manifest.json";

export const diskFiles: TFiles = {
	resolve: (where) => resolve(where),
	manifest(directory) {
		const at = join(directory, MANIFEST);
		return existsSync(at) ? JSON.parse(readFileSync(at, "utf-8")) : undefined;
	},
	remove: (file) => rmSync(file),
};
