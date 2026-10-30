/**
 * What serving the page reads and writes outside the process: the bundles shu builds, the report it writes, and a peer
 * instance's graph.
 */
import type { TRequestSigner } from "@haibun/core/lib/domains/authority-types.js";
import type { TFederatedGraphSource } from "@haibun/core/lib/steps/ports.js";

/** A served asset's text, the same gzipped, and the tag through which a browser revalidates it. */
export type TServedAsset = { content: string; gzipped(): Promise<Uint8Array<ArrayBuffer>>; etag: string };

/** The folders shu's build writes its bundles in, from the package root, under `build/assets/`, so the per-file emit of `tsc`
 *  doesn't overwrite them: the page's bundles with their chunks, and the bundles a report inlines whole. */
export const BUNDLE_DIRS = { page: "build/assets/page", whole: "build/assets" } as const;

/** The bundles `npm run build` writes in `modules/shu/build`, each by its file name. A read of a bundle refuses a bundle that
 *  isn't built, and names the build command. */
export type TBundleFile = {
	/** A file of the page's bundles by its path below their folder: a bundle, a chunk, or a source map. Undefined where the
	 *  build didn't write one at that path. */
	pageFile(path: string): TServedAsset | undefined;
	/** When a page's bundle was written, which a served page states as its build. */
	pageBuiltAt(file: string): string;
	/** A bundle as one script without imports, which a report inlines. */
	whole(file: string): string;
	/** Text a server derives, served under a strong ETag of its content's hash, so a reader revalidates it and fetches it again
	 *  only once its content changes. */
	derived(content: string): TServedAsset;
	/** The font of the graph's labels. */
	labelFont(): ArrayBuffer;
	/** The font of the DL symbols the graph's labels draw, which the label font lacks. */
	mathFont(): ArrayBuffer;
	/** The code points the font of the graph's labels covers, as a CSS `unicode-range`. */
	labelFontRanges(): string;
};

/** Writes a report at a path. */
export type TReportFile = { write(path: string, html: string): void };

/** A peer instance's clustered graph, read over RPC once its handshake completes. */
export type TPeerGraphSource = TFederatedGraphSource & {
	/** Completes the handshake, and returns the site principal the peer states. */
	connect(): Promise<string>;
	/** Requests the site principal the peer assigns this instance. */
	requestName(): Promise<string>;
};

/** The steps a peer's graph source calls: the clustered read, and the step that names a connecting site with the action it requires. */
export type TPeerCalls = { clustered: string; nameSite: { method: string; action: string } };

/** Opens a peer's graph source at `url`, signing each request with `sign`. */
export type TOpenPeerGraphSource = (url: string, sign: TRequestSigner, calls: TPeerCalls) => TPeerGraphSource;
