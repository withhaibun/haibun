/** The declaration of a browser bundle and the names its budget records, which a repository's `bundles.ts` and its bundle test share. */

/** The condition haibun's packages export their TypeScript source under, and the bundles build under it. */
export const HAIBUN_SOURCE = "haibun-source";

/** One build: its entries, each by the name of its output and the source it starts from, where it writes them, and how. */
export type TBundle = {
	entryPoints: { out: string; in: string }[];
	outdir: string;
	format: "esm" | "iife";
	/** Where an esm build splits its code: the code of a dynamic import, and what two or more of its entries and imports
	 *  share, each in a chunk in this folder below `outdir`, which an entry loads as it reaches the chunk. */
	splitting: false | { chunkDir: string };
	/** A source map beside each output, linked from the output's last line. */
	sourcemap: boolean;
	/** What the build writes beside its outputs in `outdir`, by file name, with its contents: a page or a manifest that loads them. */
	files?: Readonly<Record<string, string>>;
	/** What the build copies beside its outputs in `outdir`, by file name, from its path from the root: a page the repository holds. */
	copies?: Readonly<Record<string, string>>;
};

/** The finding a bundle's budget records: the KiB, rounded up, that loading an entry fetches. */
export const BUDGET_FINDING = "KiB";
/** The KiB that loading each entry fetches, by its output's path from the root, as a bundle budget records it. */
export type TBundleSizes = Record<string, { [BUDGET_FINDING]: number }>;
/** What brings a bundle back within its budget. */
export const BUDGET_FIX = "load the code of a rare path with a dynamic import, or import less of a package";
