/**
 * The browser bundles of both repositories, built from one definition each. A repository lists its bundles by group in a
 * `bundles.ts` that runs as the build script (`node <bundles.ts> <group>...`, `--watch` to rebuild on change) and that its
 * bundle test reads, so the test measures what the build writes. Every build writes its declared files beside its outputs and its metafile, and resolves each package to one copy
 * and zod's locales to English alone (PF25).
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { build, context, type BuildOptions, type Metafile, type Plugin } from "esbuild";
import { BUDGET_FINDING, HAIBUN_SOURCE, type TBundle, type TBundleSizes } from "../domains/bundle.js";

export { BUDGET_FINDING, BUDGET_FIX, HAIBUN_SOURCE, type TBundle, type TBundleSizes } from "../domains/bundle.js";

const KIB = 1024;
/** The folder of an installed package within a resolved path, and its name. */
const PACKAGE_DIR = /^(?<dir>.*[\\/]node_modules[\\/](?<name>@[^\\/]+[\\/][^\\/]+|[^\\/]+))[\\/]/;
/** zod's index of its locales, which its namespace exports whole, so an import of `z` would carry all 53. */
const ZOD_LOCALES = /[\\/]zod[\\/]v4[\\/]locales[\\/]index\.js$/;
/** A locale of zod in a metafile's inputs, by its file name. */
const ZOD_LOCALE_INPUT = /node_modules\/zod\/v4\/locales\/(?<locale>[^/]+)\.js$/;
const ENGLISH = "en";
const RESOLVED_FROM_ROOT = "resolvedFromRoot";
const METAFILES = "build/metafiles";
const WATCH = "--watch";

/** The installed package a path is in, or undefined for a path outside every `node_modules`. */
const packageOf = (path: string): { dir: string; name: string } | undefined => {
	const groups = PACKAGE_DIR.exec(path)?.groups;
	return groups?.dir === undefined || groups.name === undefined ? undefined : { dir: groups.dir, name: groups.name };
};
const versionOf = (dir: string): string => (JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as { version: string }).version;

/**
 * Resolves a package that a source file outside the root imports (a linked repository's source, such as haibun's beside spopg)
 * from the root, where the root installs it too, so a bundle holds one copy of zod and lit instead of one from each repository.
 * A package that only the linked repository installs resolves where it is. Two installed versions fail the build, since one copy
 * of either would serve code written against the other.
 */
const onePackageCopy = (root: string): Plugin => ({
	name: "one-package-copy",
	setup(builder) {
		builder.onResolve({ filter: /^[^./]/ }, async (args) => {
			const outsideRoot = !args.importer.startsWith(root + sep) && packageOf(args.importer) === undefined;
			if (args.kind === "entry-point" || args.pluginData?.[RESOLVED_FROM_ROOT] === true || !outsideRoot) return undefined;
			const fromRoot = await builder.resolve(args.path, { kind: args.kind, resolveDir: root, importer: args.importer, pluginData: { [RESOLVED_FROM_ROOT]: true } });
			if (fromRoot.errors.length > 0) return undefined;
			const fromImporter = await builder.resolve(args.path, { kind: args.kind, resolveDir: args.resolveDir, importer: args.importer, pluginData: { [RESOLVED_FROM_ROOT]: true } });
			const [rootPackage, importerPackage] = [packageOf(fromRoot.path), packageOf(fromImporter.path)];
			if (rootPackage !== undefined && importerPackage !== undefined && rootPackage.dir !== importerPackage.dir) {
				const [rootVersion, importerVersion] = [versionOf(rootPackage.dir), versionOf(importerPackage.dir)];
				if (rootVersion !== importerVersion)
					return {
						errors: [
							{
								text: `${args.importer} imports ${rootPackage.name} ${importerVersion} from ${importerPackage.dir}, and ${root} installs ${rootVersion}. Install one version in both repositories, then build again.`,
							},
						],
					};
			}
			return fromRoot;
		});
	},
});

/** Resolves zod's index of locales to English alone, the locale zod sets for itself. */
const zodEnglishLocale: Plugin = {
	name: "zod-english-locale",
	setup(builder) {
		builder.onResolve({ filter: /\/locales\/index\.js$/ }, async (args) => {
			if (args.pluginData?.[ZOD_LOCALES.source] === true) return undefined;
			const resolved = await builder.resolve(args.path, { kind: args.kind, resolveDir: args.resolveDir, importer: args.importer, pluginData: { [ZOD_LOCALES.source]: true } });
			if (!ZOD_LOCALES.test(resolved.path)) return resolved;
			return { path: resolved.path, namespace: zodEnglishLocale.name };
		});
		builder.onLoad({ filter: /.*/, namespace: zodEnglishLocale.name }, (args) => ({
			contents: `export { default as ${ENGLISH} } from "./${ENGLISH}.js";`,
			resolveDir: dirname(args.path),
			loader: "js",
		}));
	},
};

/** The packages of three-forcegraph's ngraph engine. A page's graph runs the library's d3 engine, which `forceEngine` "d3"
 *  selects, so a bundle doesn't hold the ngraph engine's 31 KiB. */
const NGRAPH_ENGINE = /^ngraph\.(graph|forcelayout)$/;

/** Resolves each package of three-forcegraph's ngraph engine to a call that refuses, naming the engine a page runs. */
const d3EngineAlone: Plugin = {
	name: "d3-engine-alone",
	setup(builder) {
		builder.onResolve({ filter: NGRAPH_ENGINE }, (args) => ({ path: args.path, namespace: d3EngineAlone.name }));
		builder.onLoad({ filter: /.*/, namespace: d3EngineAlone.name }, (args) => ({
			contents: `export default () => { throw new Error("${args.path} isn't bundled: a page's graph runs three-forcegraph's d3 engine. Set forceEngine to \\"d3\\""); };`,
			loader: "js",
		}));
	},
};

/** Resolves `polished`, which 3d-force-graph-vr reads a background colour's alpha with and makes it opaque with, to those
 *  two functions over tinycolor2, the colour library three-forcegraph bundles, so a bundle doesn't hold polished's 11 KiB. */
const oneColourLibrary: Plugin = {
	name: "one-colour-library",
	setup(builder) {
		builder.onResolve({ filter: /^polished$/ }, (args) => ({ path: args.path, namespace: oneColourLibrary.name, pluginData: args.resolveDir }));
		builder.onLoad({ filter: /.*/, namespace: oneColourLibrary.name }, (args) => ({
			contents: `import tinycolor from "tinycolor2";
export const parseToRgb = (color) => ({ alpha: tinycolor(color).getAlpha() });
export const opacify = (amount, color) => { const c = tinycolor(color); return c.setAlpha(Math.min(1, c.getAlpha() + amount)).toRgbString(); };`,
			loader: "js",
			resolveDir: args.pluginData,
		}));
	},
};

/** Resolves `aframe-extras`, which 3d-force-graph-vr imports whole for the movement controls of its camera, to its controls,
 *  so a bundle doesn't hold its model loaders, its pathfinding, its primitives and its other components, about 110 KiB. */
const extrasControlsAlone: Plugin = {
	name: "extras-controls-alone",
	setup(builder) {
		builder.onResolve({ filter: /^aframe-extras$/ }, (args) => builder.resolve("aframe-extras/controls/index.js", { kind: args.kind, resolveDir: args.resolveDir }));
	},
};

/** Resolves `pako`, which http-signature-zcap-invoke gzips a delegated capability with, to its deflate half, so a bundle
 *  doesn't hold the inflate code a page doesn't call. */
const gzipAlone: Plugin = {
	name: "gzip-alone",
	setup(builder) {
		builder.onResolve({ filter: /^pako$/ }, (args) => ({ path: args.path, namespace: gzipAlone.name, pluginData: args.resolveDir }));
		builder.onLoad({ filter: /.*/, namespace: gzipAlone.name }, (args) => ({
			contents: `import { gzip } from "pako/lib/deflate.js";\nexport default { gzip };`,
			loader: "js",
			resolveDir: args.pluginData,
		}));
	},
};

/** Resolves `entities`, which markdown-it decodes a character reference with, to its decoding half, so a bundle doesn't hold
 *  the encoding tables a page doesn't call, about 23 KiB. A package that imports `entities` for more than decoding resolves
 *  it whole. */
const decodeAlone: Plugin = {
	name: "decode-alone",
	setup(builder) {
		builder.onResolve({ filter: /^entities$/ }, (args) =>
			args.importer.includes(`${sep}markdown-it${sep}`) ? builder.resolve("entities/lib/decode.js", { kind: args.kind, resolveDir: args.resolveDir }) : undefined,
		);
	},
};

/** Carries the build's NODE_ENV into a bundle, as Node reads it: its value where the build states one, and undefined where it doesn't,
 *  so a bundle selects production or development as the process that builds it does, in place of esbuild's choice by minification. */
export const nodeEnvDefine = (): Record<string, string> => ({ "process.env.NODE_ENV": process.env.NODE_ENV === undefined ? "undefined" : JSON.stringify(process.env.NODE_ENV) });

/** The options that build a bundle of the repository at `root` for a browser. */
export const bundleOptions = (root: string, bundle: TBundle): BuildOptions & { metafile: true; plugins: Plugin[] } => ({
	absWorkingDir: root,
	entryPoints: bundle.entryPoints,
	outdir: bundle.outdir,
	format: bundle.format,
	splitting: bundle.splitting !== false,
	...(bundle.splitting === false ? {} : { chunkNames: `${bundle.splitting.chunkDir}/[name]-[hash]` }),
	sourcemap: bundle.sourcemap ? "linked" : false,
	bundle: true,
	platform: "browser",
	target: "es2022",
	minify: true,
	conditions: [HAIBUN_SOURCE],
	define: nodeEnvDefine(),
	plugins: [onePackageCopy(root), zodEnglishLocale, d3EngineAlone, oneColourLibrary, extrasControlsAlone, gzipAlone, decodeAlone],
	metafile: true,
	logLevel: "warning",
});

/** Where a build writes its metafile: in the repository's ignored `build/metafiles/`, apart from its outputs, in the folder of
 *  its `outdir` and named for its first entry, so two builds of the same entries keep one each. */
const metafilePath = (root: string, bundle: TBundle): string => {
	const [first] = bundle.entryPoints;
	if (first === undefined) throw new Error(`a bundle in ${root} that writes to ${bundle.outdir} lacks an entry. Give it one in its bundles.ts.`);
	return join(root, METAFILES, bundle.outdir, `${first.out}.meta.json`);
};

/** What a bundle writes beside its outputs, by file name, with its contents: the files it declares, and those it copies from the root. */
export function besideFiles(root: string, bundle: TBundle): Record<string, string> {
	const copied = bundle.copies === undefined ? [] : Object.entries(bundle.copies).map(([name, from]) => [name, readFileSync(join(root, from), "utf8")]);
	return { ...bundle.files, ...Object.fromEntries(copied) };
}

/** Builds each bundle and writes its files and its metafile, or, with `watch`, rebuilds each as its sources change. */
export async function buildBundles(root: string, bundles: readonly TBundle[], watch: boolean): Promise<void> {
	const optionsOf = (bundle: TBundle): BuildOptions => {
		const options = bundleOptions(root, bundle);
		const writesBeside: Plugin = {
			name: "write-files-and-metafile",
			setup(builder) {
				builder.onEnd(({ metafile }) => {
					if (metafile === undefined) return;
					const at = metafilePath(root, bundle);
					mkdirSync(dirname(at), { recursive: true });
					writeFileSync(at, JSON.stringify(metafile));
					for (const [name, contents] of Object.entries(besideFiles(root, bundle))) writeFileSync(join(root, bundle.outdir, name), contents);
				});
			},
		};
		return { ...options, plugins: [...options.plugins, writesBeside] };
	};
	if (!watch) {
		// A build names its chunks by their content, and a page loads only the present build's chunks, so an earlier build's are emptied first.
		for (const { outdir, splitting } of bundles) if (splitting !== false) rmSync(join(root, outdir, splitting.chunkDir), { recursive: true, force: true });
		await Promise.all(bundles.map((bundle) => build(optionsOf(bundle))));
		return;
	}
	const contexts = await Promise.all(bundles.map((bundle) => context(optionsOf(bundle))));
	await Promise.all(contexts.map((ctx) => ctx.watch()));
}

/** Runs a repository's `bundles.ts` as its build script: it builds the groups its arguments name, and `--watch` rebuilds them
 *  as their sources change. */
export async function runBundleScript(root: string, groups: Readonly<Record<string, readonly TBundle[]>>): Promise<void> {
	const named = process.argv.slice(2).filter((arg) => arg !== WATCH);
	const unknown = named.filter((name) => !(name in groups));
	if (named.length === 0 || unknown.length > 0)
		throw new Error(
			`${process.argv[1]} builds the groups its arguments name${unknown.length > 0 ? `, and ${unknown.join(", ")} isn't a group` : ""}. Name one or more of: ${Object.keys(groups).join(", ")}.`,
		);
	const bundles = Object.entries(groups).flatMap(([name, group]) => (named.includes(name) ? group : []));
	await buildBundles(root, bundles, process.argv.includes(WATCH));
}

/** An esbuild failure, with each error and the file that holds it. */
type TBuildFailure = { errors?: Array<{ text: string; location?: { file: string } | null }> };

/** Builds a bundle in memory, as its script builds it, and returns its metafile and the text of each output by its path from the
 *  root, or throws each error of the build with the file that holds it. */
export async function buildInMemory(root: string, bundle: TBundle): Promise<{ metafile: Metafile; outputs: Record<string, string> }> {
	try {
		const { metafile, outputFiles } = await build({ ...bundleOptions(root, bundle), write: false, logLevel: "silent" });
		return { metafile, outputs: Object.fromEntries(outputFiles.map((file) => [relative(root, file.path), file.text])) };
	} catch (err) {
		const { errors } = err as TBuildFailure;
		throw new Error(errors !== undefined && errors.length > 0 ? errors.map((e) => `${e.location?.file ?? root}: ${e.text}`).join("\n") : String(err), { cause: err });
	}
}

/** Builds each bundle in memory, as its script builds it, and returns what each holds that the options exclude and the KiB that
 *  loading each entry fetches, as a bundle budget records it. */
export async function measureBundles(root: string, bundles: readonly TBundle[]): Promise<{ excluded: string[]; sizes: TBundleSizes }> {
	const measured = await Promise.all(bundles.map(async (bundle) => ({ bundle, metafile: (await buildInMemory(root, bundle)).metafile })));
	return {
		excluded: measured.flatMap(({ metafile }) => excludedInputs(metafile)),
		sizes: Object.fromEntries(measured.flatMap(({ bundle, metafile }) => Object.entries(entrySizes(bundle, metafile)))),
	};
}

/** The bytes an output loads beyond the outputs `seen` already holds: its own and those of each chunk it imports. */
function loadedBytes(metafile: Metafile, output: string, seen: Set<string>): number {
	if (seen.has(output)) return 0;
	seen.add(output);
	const found = metafile.outputs[output];
	if (found === undefined) throw new Error(`the metafile lists a chunk ${output} without its output. Build again.`);
	return found.bytes + found.imports.filter((i) => i.kind === "import-statement").reduce((sum, i) => sum + loadedBytes(metafile, i.path, seen), 0);
}

/** Each entry of `bundle` by its output's path from the root, with the KiB that loading it on a page by itself fetches, as a
 *  bundle budget records it: a chunk two entries share counts in each. */
function entrySizes(bundle: TBundle, metafile: Metafile): TBundleSizes {
	const outputs = Object.entries(metafile.outputs);
	return Object.fromEntries(
		bundle.entryPoints.map((entry) => {
			const found = outputs.find(([, output]) => output.entryPoint === entry.in);
			if (found === undefined) throw new Error(`the metafile of ${bundle.outdir} lacks the output of ${entry.in}. Build again.`);
			return [found[0], { [BUDGET_FINDING]: Math.ceil(loadedBytes(metafile, found[0], new Set()) / KIB) }];
		}),
	);
}

/** What a metafile's inputs hold that the bundle options exclude: a package from two folders, or a locale of zod besides English. */
function excludedInputs(metafile: Metafile): string[] {
	const folders = new Map<string, Set<string>>();
	const locales: string[] = [];
	// The English locale's index, which the plugin writes, is listed under the plugin's namespace.
	for (const input of Object.keys(metafile.inputs).filter((path) => !path.startsWith(`${zodEnglishLocale.name}:`))) {
		const found = packageOf(input);
		const held = found === undefined ? undefined : folders.get(found.name);
		if (held !== undefined && found !== undefined) held.add(found.dir);
		else if (found !== undefined) folders.set(found.name, new Set([found.dir]));
		const locale = ZOD_LOCALE_INPUT.exec(input)?.groups?.locale;
		if (locale !== undefined && locale !== ENGLISH) locales.push(`zod's locale ${locale} (${input})`);
	}
	const duplicated = [...folders].filter(([, dirs]) => dirs.size > 1).map(([name, dirs]) => `${name} from ${[...dirs].join(" and ")}`);
	return [...duplicated, ...locales];
}
