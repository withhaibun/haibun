/**
 * The bundles `npm run build` writes in `modules/shu/build`, read from disk on each request, so a rebuilt bundle is served
 * on the next request without a restart. A bundle that isn't built is refused with the command that builds it (SH29).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { sha256 } from "@haibun/core/lib/domains/digest.js";
import { BUNDLE_DIRS, type TBundleFile, type TServedAsset } from "../ports.js";

/** The package root, so one path resolves from `src/` and from `build/`. */
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PAGE_DIR = join(PACKAGE_ROOT, BUNDLE_DIRS.page);
const WHOLE_DIR = join(PACKAGE_ROOT, BUNDLE_DIRS.whole);
/** A file the page's build writes: a bundle or a chunk, or its source map, by its path below the page's folder, at most one
 *  folder deep. */
const PAGE_FILE = /^(?:[\w-]+\/)?[\w-]+\.js(?:\.map)?$/;

/** The subset of Noto Sans that draws the graph's labels. */
const LABEL_FONT_SUBSET = "latin";
/** The font of the graph's labels, a dependency of the package: Noto Sans, the Latin subset, in the WOFF troika reads. */
const LABEL_FONT_FILE = createRequire(import.meta.url).resolve(`@fontsource/noto-sans/files/noto-sans-${LABEL_FONT_SUBSET}-400-normal.woff`);
/** The font of the DL symbols the graph's labels draw: Noto Sans Math, in the WOFF troika reads, which its package names `latin`
 *  though it holds the font's whole set of mathematical symbols. */
export const MATH_FONT_FILE = createRequire(import.meta.url).resolve("@fontsource/noto-sans-math/files/noto-sans-math-latin-400-normal.woff");
/** The package's `unicode-range` of each subset, beside its folder of font files. */
const LABEL_FONT_RANGES_FILE = join(dirname(LABEL_FONT_FILE), "..", "unicode.json");

/** The command that writes every bundle. */
export const BUILD_COMMAND = "npm run build in modules/shu";

/** Runs `read` on the file at `path`, or throws a refusal that names the bundle and the command that builds it. */
function built<T>(path: string, what: string, read: (path: string) => T): T {
	try {
		return read(path);
	} catch (err) {
		throw new Error(`${what} at ${path} isn't built. Run ${BUILD_COMMAND}.`, { cause: err });
	}
}

const text = (path: string): string => readFileSync(path, "utf-8");
const writtenAt = (path: string): Date => statSync(path).mtime;
/** Each file served, by its path, with the tag of the write that it reads. */
const served = new Map<string, TServedAsset>();
/** A file and the tag of its write, so a browser revalidates it and a rebuilt file gets a fresh tag. A file is read again only
 *  once its write changes, and gzipped at its first gzipped response. */
const servedAsset = (path: string): TServedAsset => {
	const { mtimeMs, size } = statSync(path);
	const etag = `"${mtimeMs}-${size}"`;
	const held = served.get(path);
	if (held?.etag === etag) return held;
	const asset = taggedAsset(text(path), etag);
	served.set(path, asset);
	return asset;
};

/** Text served under `etag`, gzipped at its first gzipped response. */
function taggedAsset(content: string, etag: string): TServedAsset {
	let gzipped: Uint8Array<ArrayBuffer> | undefined;
	const gzip = (): Uint8Array<ArrayBuffer> => {
		if (gzipped === undefined) gzipped = new Uint8Array(gzipSync(content));
		return gzipped;
	};
	return { content, etag, gzipped: gzip };
}

/** The bytes of the font file at `path`. */
function fontBytes(path: string): ArrayBuffer {
	const font = readFileSync(path);
	return font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength) as ArrayBuffer;
}

/** The bundle files under `build/`. */
export function bundleFile(): TBundleFile {
	return {
		pageFile: (path) => {
			const file = join(PAGE_DIR, path);
			return PAGE_FILE.test(path) && existsSync(file) ? servedAsset(file) : undefined;
		},
		pageBuiltAt: (file) => built(join(PAGE_DIR, file), `the page's bundle ${file}`, writtenAt).toISOString(),
		whole: (file) => built(join(WHOLE_DIR, file), `the bundle ${file}`, servedAsset).content,
		derived: (content) => taggedAsset(content, `"${sha256(content)}"`),
		labelFont: () => fontBytes(LABEL_FONT_FILE),
		mathFont: () => fontBytes(MATH_FONT_FILE),
		labelFontRanges: () => {
			const ranges: unknown = JSON.parse(text(LABEL_FONT_RANGES_FILE))[LABEL_FONT_SUBSET];
			if (typeof ranges !== "string") throw new Error(`${LABEL_FONT_RANGES_FILE} doesn't state the range of the ${LABEL_FONT_SUBSET} subset: reinstall @fontsource/noto-sans`);
			return ranges;
		},
	};
}
