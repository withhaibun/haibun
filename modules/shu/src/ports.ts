/**
 * What serving the page reads and writes outside the process: the bundles shu builds, the report it writes, and a peer
 * instance's graph.
 */
import type { TRequestSigner } from "@haibun/core/lib/authority-types.js";
import type { TFederatedGraphSource } from "@haibun/core/lib/quad-types.js";

/** A served asset's text, and the tag through which a browser revalidates it. */
export type TServedAsset = { content: string; etag: string };

/** The bundles `npm run build` writes in `modules/shu/build`. Each read refuses a bundle that isn't built, and names the build command. */
export type TBundleFile = {
	/** The app's bundle, which the served page inlines. */
	app(): string;
	/** When the app's bundle was written, which a served page states as its build. */
	appBuiltAt(): string;
	/** The report's bundle, which a report inlines. */
	report(): string;
	/** The polymorphic graph view and the class browser, which one asset registers. */
	polymorphic(): TServedAsset;
	/** The app bundle's source map. */
	sourceMap(): string;
	/** The font of the graph's labels. */
	labelFont(): ArrayBuffer;
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
