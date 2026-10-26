#!/usr/bin/env node
/**
 * shu's browser bundles. The served page loads its bundle, and the graph view's as the reader opens it, with chunks: the code of
 * a rare path, and what the two share, so the graph view loads its scene alone. A report inlines each whole, as a script without
 * imports. `npm run build` runs this file (`node scripts/bundles.ts page`), and `src/page-bundles.test.ts` holds each to its budget.
 */
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBundleScript, type TBundle } from "@haibun/tooling/bundles.js";
import { BUNDLE_NAMES, PAGE_CHUNK_DIR } from "../src/domains/bundle-files.ts";
import { BUNDLE_DIRS } from "../src/ports.ts";

/** The package root: each bundle's paths are relative to this folder. */
export const SHU_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const APP = "entries/shu-app.ts";
const POLYMORPHIC = "entries/polymorphic-bundle.ts";

export const SHU_BUNDLES: readonly TBundle[] = [
	{
		entryPoints: [
			{ out: BUNDLE_NAMES.page, in: APP },
			{ out: BUNDLE_NAMES.polymorphic, in: POLYMORPHIC },
		],
		outdir: BUNDLE_DIRS.page,
		format: "esm",
		splitting: { chunkDir: PAGE_CHUNK_DIR },
		sourcemap: true,
	},
	{ entryPoints: [{ out: BUNDLE_NAMES.report, in: APP }], outdir: BUNDLE_DIRS.whole, format: "iife", splitting: false, sourcemap: false },
	{ entryPoints: [{ out: BUNDLE_NAMES.polymorphic, in: POLYMORPHIC }], outdir: BUNDLE_DIRS.whole, format: "iife", splitting: false, sourcemap: false },
];

if (process.argv[1] === fileURLToPath(import.meta.url)) await runBundleScript(SHU_ROOT, { page: SHU_BUNDLES });
