/**
 * ShuStepper: serves the @haibun/shu hypermedia SPA.
 * Any application that loads this stepper gets a UI driven entirely by stepper concerns.
 */
import type { TActualityId } from "@haibun/core/lib/rpc-wire.js";
import { readFileSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { gzipSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { AStepper, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import { actionOK, actionNotOK, actionOKWithProducts, getFromRuntime, getStepperOption, intOrError } from "@haibun/core/lib/util/index.js";
import type { TDeploymentSettings, TPageBuild } from "./rpc-registry.js";
import { currentVersion } from "@haibun/core/currentVersion.js";
import { getJsonLdContext } from "@haibun/core/lib/hypermedia.js";
import { Access, haibunNsForHost, isPersisted } from "@haibun/core/lib/resources.js";
import { requestBaseIri } from "@haibun/core/lib/request-context.js";
import { getAuthority } from "@haibun/core/lib/session-authority.js";
import type { IWebServer } from "@haibun/web-server-hono/defs.js";
import { WEBSERVER } from "@haibun/web-server-hono/defs.js";
import type { Context } from "@haibun/web-server-hono/defs.js";
import { CONTEXT_DOCUMENT, SHU_TYPE, SHU_TAG, HYDRATION_ID } from "./consts.js";
import { DOMAIN_SHU_APPS, ShuAppsSchema } from "./schemas.js";
import type { IQuadStore, TQuad } from "@haibun/core/lib/quad-types.js";
import { buildGraphModelFromQuads } from "./graph-model.js";
import { withOntologySchema } from "./graph/ontology-projection.js";
import { enumerateStandardVocab } from "./graph/standard-vocabulary.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import type { IHasOptions } from "@haibun/core/lib/astepper.js";
import { DOMAIN_ROUTE } from "@haibun/core/lib/domains.js";
import { pagePolicy } from "./content-security-policy.js";

/**
 * Project the persisted quads into the renderer-agnostic graph model (nodes + typed-reference edges) the SPA also
 * builds client-side. The one place the server reproduces it: `get graph layout` reads the node/edge sets back, and the
 * offline report serializes the quad snapshot. The FULL snapshot is serialized, instrumentation included, exactly like
 * the live getClusteredQuads RPC; the view hides instrumentation by default (toggleable) via effectiveHiddenTypes, so the
 * offline report behaves identically to live.
 */
export async function buildGraphSource(world: TWorld): Promise<
	| {
			quads: TQuad[];
			clusters: Awaited<ReturnType<NonNullable<IQuadStore["getClusteredQuads"]>>>["clusters"];
			nodeMap: Map<string, { graph: string; subject: string }>;
			edges: { source: string; predicate: string; object: string }[];
	  }
	| undefined
> {
	const store = world.shared.getStore();
	if (!store.getClusteredQuads) return undefined;
	// Scope "own": the standalone report is this site's own record: a shutdown-time capture must not depend on
	// federated peers still being reachable, and each peer's record is its own report.
	const raw = await store.getClusteredQuads({ perTypeLimit: 10000, accessLevel: Access.private, scope: "own" });
	// Include the schema exactly as the live getClusteredQuads does, so the offline report's ontology/class-browser view
	// matches live, pruned against the serialized graph itself (the report IS the full data). The one assembler, so the two don't drift.
	const standardVocab = await enumerateStandardVocab(world.domains);
	const { quads, clusters } = withOntologySchema({ quads: raw.quads as TQuad[], clusters: raw.clusters }, raw.quads as TQuad[], world.domains, standardVocab);
	const model = buildGraphModelFromQuads(quads as TQuad[]);
	const nodeMap = new Map(model.nodes.map((n) => [n.id, { graph: n.type, subject: n.id }]));
	const edges = model.edges.map((e) => ({ source: e.from, predicate: e.predicate, object: e.to }));
	return { quads: quads as TQuad[], clusters, nodeMap, edges };
}

/** The domain of where a graph view placed each node. */
const DOMAIN_GRAPH_LAYOUT = "graph-layout";
const DOMAIN_SHU_VIEW_COLLECTION = "shu-view-collection";
const ShuViewCollectionSchema = z.object({
	view: z.string().optional(),
	views: z.array(z.object({ id: z.string(), description: z.string(), component: z.string() })),
});

// Nodes and edges as pipe-delimited tokens, node `graph|subject|label`, edge `source|predicate|target`:
// so a feature can match a relationship without parsing the rendered graph (e.g. `matches g.edges with "*|discloses|*"`).
const GraphLayoutSchema = z.object({
	nodes: z.array(z.string()),
	edges: z.array(z.string()),
	clusters: z.array(z.object({ type: z.string(), total: z.number(), sampled: z.number() })),
});

const __dirname = dirname(fileURLToPath(import.meta.url));

const BUNDLE_PATH = join(__dirname, "..", "build", "shu-bundle.js");

/** The build the served page's code is from: this module's version, and when its bundle was written. A deployment
 *  serving a page older than its source is recognized by it. */
const servedBuild = (): TPageBuild => ({ version: currentVersion, builtAt: statSync(BUNDLE_PATH).mtime.toISOString() });

function loadBundle(): string {
	const bundlePath = BUNDLE_PATH;
	try {
		return readFileSync(bundlePath, "utf-8");
	} catch {
		return 'document.getElementById("shu-main").innerHTML = "<div>SPA bundle not found. Run: npm run build in @haibun/shu</div>";';
	}
}

/** The bundle for the standalone report: the minified production build (≈half the development build). Falls back to the
 *  development build if the report bundle is not built yet; the two bundles don't carry a source map, which the served page adds. */
export function loadReportBundle(): string {
	try {
		return readFileSync(join(__dirname, "..", "build", "shu-report-bundle.js"), "utf-8");
	} catch {
		return loadBundle();
	}
}

function spaDocument(basePath: string, scriptsHtml: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Haibun</title>
  <style>
    * { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; overflow: hidden; }
    /* The reader's own fonts: an app over private records doesn't call a font service, and a page served here
       renders the same without a network at all. A named face is used where it is installed, the system's otherwise. */
    body { font-family: "Source Sans 3", system-ui, sans-serif; }
    code, pre, table, td, th { font-family: "Source Code Pro", ui-monospace, monospace; }
  </style>
</head>
<body>
  <div data-testid="shu-app" style="height:100%;">
    <span data-testid="shu-header" style="position:absolute;width:1px;height:1px;overflow:hidden;">&nbsp;</span>
    <main id="shu-main" data-testid="shu-main" data-api-base="${basePath}" style="height:100%;">
    </main>
  </div>
${scriptsHtml}
</body>
</html>`;
}

// What the served page's hydration carries: the actuality whose records it reads, and the timings this deployment set.
// A record of a run carries actuality itself and writes its own hydration element (buildReportHtml).
export function buildSpaHtml(basePath: string, bundle: string, hydration: TServedHydration, nonce: string): string {
	const scripts = `  <script type="application/json" id="${HYDRATION_ID}">${JSON.stringify(hydration)}</script>\n\n  <script nonce="${nonce}">${bundle}\n//# sourceMappingURL=${SPA_SOURCE_MAP}</script>`;
	return spaDocument(basePath, scripts);
}

/**
 * Offline report: a `{bundle, hydration, scripts}` payload plus a tiny loader that recreates the `#shu-hydration` script
 * the bundle reads, injects the in-view component scripts, then the bundle (which boots via app.ts's readyState check).
 * `compressed` embeds the payload as gzip+base64 to keep shared files small (base64 doesn't need `</` escaping); uncompressed
 * embeds plain JSON (only `</` escaped) so the redacted text can be read and audited directly in the file: the
 * secret-obscuring check greps it.
 */
export function buildReportHtml(basePath: string, payload: string, compressed: boolean): string {
	const inject = `const h = document.createElement("script"); h.type = "application/json"; h.id = "${HYDRATION_ID}"; h.textContent = hydration; document.body.appendChild(h);
    for (const s of scripts) { const el = document.createElement("script"); el.textContent = s; document.body.appendChild(el); }
    const b = document.createElement("script"); b.textContent = bundle; document.body.appendChild(b);`;
	const loader = compressed
		? `  <script type="application/octet-stream" id="shu-payload">${gzipSync(payload).toString("base64")}</script>
  <script>
  (async () => {
    const raw = Uint8Array.from(atob(document.getElementById("shu-payload").textContent), (c) => c.charCodeAt(0));
    const { bundle, hydration, scripts } = JSON.parse(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip"))).text());
    ${inject}
  })();
  </script>`
		: `  <script type="application/json" id="shu-payload">${payload.replaceAll("</", "<\\/")}</script>
  <script>
  (() => {
    const { bundle, hydration, scripts } = JSON.parse(document.getElementById("shu-payload").textContent);
    ${inject}
  })();
  </script>`;
	return spaDocument(basePath, loader);
}

/** What a served page's hydration carries. */
type TServedHydration = { actualityId: TActualityId; settings: TDeploymentSettings };

function createSpaHandler(basePath: string, hydration: () => TServedHydration) {
	// Read the bundle from disk on every request rather than caching it at
	// handler construction, so a rebuilt shu-bundle.js is served after
	// `npm run build` + reload without a service restart. The ~3.7MB readFileSync
	// is sub-ms on a warm cache.
	// `no-store` is required because the bundle is inlined in the HTML response:
	// `no-cache` still permits cached storage with revalidation, so a soft reload
	// could keep serving a stale bundle; `no-store` forbids caching entirely.
	return (c: Context) => {
		const served = hydration();
		// A nonce per response, so a script a page's policy runs is one this response served.
		const nonce = randomBytes(SCRIPT_NONCE_BYTES).toString("base64");
		c.header("Cache-Control", "no-store, must-revalidate");
		c.header("Pragma", "no-cache");
		c.header("Content-Security-Policy", pagePolicy(served.settings.embedderOrigin, nonce));
		return c.html(buildSpaHtml(basePath, loadBundle(), served, nonce));
	};
}

/** An origin as a page states it: a scheme and a host, such as `https://example.com` or `chrome-extension://<id>`. */
const ORIGIN = /^[a-z][a-z0-9+.-]*:\/\/[^/\s]+$/;

// The graph view's bundled IIFE, under build/assets/ so tsc's per-file ESM emit cannot clobber it. Anchored at the
// package root so one path resolves whether this runs from `src/` or `build/`, and cached by mtime so a rebuilt
// bundle is served on the next request.
const POLYMORPHIC_VIEW_JS = "/assets/shu-polymorphic-graph-view.js";
/** Where the served page's source map is read from. The bundle is inlined in the page, so the map is addressed
 *  absolutely rather than beside a file that is never fetched; only a reader with developer tools open asks for it. */
const SPA_SOURCE_MAP = "/assets/shu-bundle.js.map";
/** How many random bytes a page's script nonce holds: 128 bits, as CSP3 asks of a nonce. */
const SCRIPT_NONCE_BYTES = 16;
const POLYMORPHIC_BUNDLE_PATH = join(__dirname, "..", "build", "assets", "shu-polymorphic-graph-view.js");
let polymorphicBundleCache: { mtimeMs: number; content: string } | undefined;
const loadPolymorphicBundle = (): { content: string; etag: string } => {
	const mtimeMs = statSync(POLYMORPHIC_BUNDLE_PATH).mtimeMs;
	if (polymorphicBundleCache?.mtimeMs !== mtimeMs) polymorphicBundleCache = { mtimeMs, content: readFileSync(POLYMORPHIC_BUNDLE_PATH, "utf-8") };
	return { content: polymorphicBundleCache.content, etag: `"polymorphic-${mtimeMs}"` };
};

function validateMountPath(path: string): string | undefined {
	if (!path) return "path is required";
	if (!path.startsWith("/")) return 'path must start with "/"';
	if (path.length > 1 && path.endsWith("/")) return 'path must not end with "/"';
	return undefined;
}

export default class ShuStepper extends AStepper implements IHasOptions {
	/** The servers that serve the view bundle: one route per server, however many apps it mounts. */
	private bundleServedOn = new WeakSet<IWebServer>();
	/** The path of each app this feature's web server serves. */
	private readonly appPaths = new Set<string>();
	description = "Serves the @haibun/shu hypermedia SPA at a given path";

	async setWorld(world: TWorld, steppers: AStepper[]): Promise<void> {
		await super.setWorld(world, steppers);
		const timing = (option: string): number | undefined => {
			const set = getStepperOption(this, option, world.moduleOptions);
			return set === undefined ? undefined : Number(set);
		};
		const streamReconnectAfterMs = timing("STREAM_RECONNECT_AFTER_MS");
		const responseTimeoutMs = timing("RESPONSE_TIMEOUT_MS");
		const embedderOrigin = getStepperOption(this, "EMBEDDER_ORIGIN", world.moduleOptions);
		const askToolLimit = timing("ASK_TOOL_LIMIT");
		this.settings = {
			...(streamReconnectAfterMs === undefined ? {} : { streamReconnectAfterMs }),
			...(responseTimeoutMs === undefined ? {} : { responseTimeoutMs }),
			...(embedderOrigin === undefined ? {} : { embedderOrigin }),
			...(askToolLimit === undefined ? {} : { askToolLimit }),
		};
	}

	cycles = {
		// A feature's web server starts without the routes the previous feature mounted, so which servers serve the bundle
		// doesn't outlive the feature, or the next one doesn't serve a bundle.
		startFeature: (): void => {
			this.bundleServedOn = new WeakSet();
			this.appPaths.clear();
		},
		getConcerns: () => ({
			domains: [
				// Built-in shu views, registering them as domains makes them discoverable
				// via `show views` (the picker iterates domains with `ui.component`).
				// External steppers register their own view domains the same way.
				{
					selectors: [SHU_TAG.POLYMORPHIC_GRAPH_VIEW],
					schema: z.object({}),
					description: "The polymorphic graph view: one graph as a force cloud, a layered flow, a gantt or a sequence",
					ui: {
						component: SHU_TAG.POLYMORPHIC_GRAPH_VIEW,
						js: POLYMORPHIC_VIEW_JS,
						jsContent: loadPolymorphicBundle().content,
						summary: "Graph view",
						// The site's graph presenter: a view embedding "the graph" finds this through ui.presents rather than
						// naming a component.
						presents: "graph",
					},
				},
				{
					selectors: ["shu-class-browser"],
					schema: z.object({}),
					description: "Schema (class/property) browser over the live graph",
					ui: {
						component: "shu-class-browser",
						// Defined in the SAME bundle as the graph view: one served asset registers both.
						js: POLYMORPHIC_VIEW_JS,
						jsContent: loadPolymorphicBundle().content,
						summary: "Class browser",
						// The site's schema presenter: the type column embeds this for its schema view.
						presents: "schema",
					},
				},
				{ selectors: [SHU_TAG.MONITOR_COLUMN], schema: z.object({}), description: "Execution monitor and event log", ui: { component: SHU_TAG.MONITOR_COLUMN } },
				{ selectors: [SHU_TAG.DOCUMENT_COLUMN], schema: z.object({}), description: "Document/artifact viewer", ui: { component: SHU_TAG.DOCUMENT_COLUMN } },
				{ selectors: [DOMAIN_SHU_APPS], schema: ShuAppsSchema, description: "Where an instance serves shu" },
				{ selectors: [DOMAIN_GRAPH_LAYOUT], schema: GraphLayoutSchema, description: "Where a graph view placed each node" },
				{
					selectors: [DOMAIN_SHU_VIEW_COLLECTION],
					schema: ShuViewCollectionSchema,
					description: "Catalog of registered views",
					ui: { component: SHU_TYPE.VIEW_COLLECTION, summary: "Available Views" },
				},
			],
		}),
	};

	/** What a deployment sets for the app this stepper serves: the timings its page applies. */
	options = {
		RESPONSE_TIMEOUT_MS: {
			desc: "How long a call to this site may take before the page reads it as not answering and reads what the device holds, in milliseconds. Unset, the page allows what the product carries",
			parse: (input: string) => intOrError(input),
		},
		STREAM_RECONNECT_AFTER_MS: {
			desc: "How long after the event stream breaks the page opens it again, in milliseconds. Unset, the page opens it on the interval the subscriber carries",
			parse: (input: string) => intOrError(input),
		},
		ASK_TOOL_LIMIT: {
			desc: "The rounds of tool calls an ask starts with, from 0 to 99, before the reader chooses. Unset, an ask starts with 5",
			parse: (input: string) => {
				const parsed = intOrError(input);
				const rounds = parsed.result;
				return rounds !== undefined && (rounds < 0 || rounds > 99) ? { parseError: `${input} isn't from 0 to 99` } : parsed;
			},
		},
		EMBEDDER_ORIGIN: {
			desc: "The origin of a page that embeds shu in a frame and posts it the page the reader is on, such as a browser extension's panel (`chrome-extension://<id>`). Unset, only this site frames shu",
			parse: (input: string) => (ORIGIN.test(input) ? { result: input } : { parseError: `${input} isn't an origin: a scheme and a host, such as chrome-extension://<id>` }),
		},
	};
	/** The timings and the embedding page's origin this deployment set, written into every page it serves. A deployment
	 *  that doesn't set them serves a page that runs on the values the product carries. */
	private settings: TDeploymentSettings = {};

	steps = {
		serveShuApp: {
			gwta: `serve shu app at {path: ${DOMAIN_ROUTE}}`,
			action: ({ path }: { path: string }) => {
				const webserver = getFromRuntime(this.getWorld().runtime, WEBSERVER) as IWebServer;
				if (!webserver) return actionNotOK("webserver not available, load web-server-stepper before shu");
				const pathError = validateMountPath(path);
				if (pathError) return actionNotOK(pathError);
				this.serveApp(webserver, path);
				this.appPaths.add(path);
				return actionOK();
			},
		},
		showShuApps: {
			read: true,
			readsAt: Access.public,
			gwta: "show shu apps",
			description: "Where this instance serves shu: the path of each app it mounted, which a reader opens under the instance's address.",
			productsDomain: DOMAIN_SHU_APPS,
			action: () => actionOKWithProducts({ apps: [...this.appPaths] }),
		},
		maximizeView: {
			gwta: "maximize view",
			action: () => actionOK(),
		},
		showViews: {
			gwta: "show views",
			productsDomain: DOMAIN_SHU_VIEW_COLLECTION,
			action: () => {
				const domains = this.getWorld().domains;
				const views = Object.values(domains)
					.filter((d) => typeof d.ui?.component === "string")
					.map((d) => ({
						id: (isPersisted(d.topology) ? d.topology.persistedAs : undefined) || d.selectors[0],
						description: d.description || d.selectors[0],
						component: String(d.ui?.component),
					}));
				return actionOKWithProducts({ view: "views", views });
			},
		},
		showPolymorphicGraphView: {
			gwta: "show polymorphic graph view",
			// Opened through the same affordance path as every other view: the products domain is the view's own, and the
			// step-hypermedia projection injects what mounts it from the registered declaration.
			productsDomain: SHU_TAG.POLYMORPHIC_GRAPH_VIEW,
			action: () => actionOKWithProducts({}),
		},
		getGraphLayout: {
			gwta: "get graph layout",
			productsDomain: DOMAIN_GRAPH_LAYOUT,
			action: async () => {
				const built = await buildGraphSource(this.getWorld());
				if (!built) return actionNotOK("QuadStore does not support getClusteredQuads");
				const { nodeMap, edges: modelEdges, clusters } = built;
				const labelOf = (g: string, s: string) => clusters.find((c) => c.type === g)?.displayLabels?.[s] ?? s;
				const nodes = [...nodeMap.values()].map((n) => `${n.graph}|${n.subject}|${labelOf(n.graph, n.subject)}`);
				const edges = modelEdges.map((e) => `${e.source}|${e.predicate}|${e.object}`);
				const layoutClusters = clusters.map((c) => ({ type: c.type, total: c.totalCount, sampled: c.sampledCount }));
				return actionOKWithProducts({ nodes, edges, clusters: layoutClusters });
			},
		},
	} as const satisfies TStepperSteps;

	/** Serve the app on a server at a path, with the view bundle, its source map and the JSON-LD context the page reads. */
	serveApp(webserver: IWebServer, path: string): void {
		// The page boots with the actualityId of the records it reads and what this deployment set: it keeps its own key, and
		// reads what was delegated to it here. Whether a delegation verifies here is read for each page served, since a
		// verifier may be registered after the app is.
		const hydration = (): TServedHydration => ({
			actualityId: this.getWorld().runtime.actualityId,
			settings: {
				...this.settings,
				build: servedBuild(),
				allowedWithoutDelegation: [...webserver.allowedWithoutDelegation],
				verifiesDelegations: getAuthority(this.getWorld().runtime)?.hasVerifier() === true,
			},
		});
		webserver.addRoute("get", path, { description: `Shu SPA mounted at ${path}` }, createSpaHandler(path, hydration));
		const domains = this.getWorld().domains;
		// The context varies only by serving host, drawn from a tiny set of origins, build it once per host.
		const byHost = new Map<string, Record<string, unknown>>();
		const jsonLdHandler = (c: Context) => {
			const ns = haibunNsForHost(requestBaseIri(c.req.header()));
			let ctx = byHost.get(ns);
			if (!ctx) byHost.set(ns, (ctx = getJsonLdContext(domains, ns)));
			return c.json(ctx);
		};
		// The graph view's bundle, served once per host: `no-cache` revalidates, so an unchanged bundle answers 304
		// and a rebuilt one gets a fresh ETag and a full body.
		if (!this.bundleServedOn.has(webserver)) {
			this.bundleServedOn.add(webserver);
			webserver.addRoute("get", POLYMORPHIC_VIEW_JS, { description: "The polymorphic graph view and the class browser" }, (c: Context) => {
				const { content, etag } = loadPolymorphicBundle();
				c.header("ETag", etag);
				c.header("Cache-Control", "no-cache");
				if (c.req.header("if-none-match") === etag) return c.body(null, 304);
				c.header("Content-Type", "application/javascript");
				return c.body(content);
			});
			webserver.addRoute("get", SPA_SOURCE_MAP, { description: "Source map for the served shu bundle" }, (c: Context) => {
				try {
					c.header("Content-Type", "application/json");
					return c.body(readFileSync(join(__dirname, "..", "build", "shu-bundle.js.map"), "utf-8"));
				} catch {
					return c.body("the source map is not built; run npm run build in @haibun/shu", 404);
				}
			});
		}
		webserver.addRoute("get", CONTEXT_DOCUMENT.wellKnown, { description: "JSON-LD @context for haibun domain vocabulary" }, jsonLdHandler);
		webserver.addRoute("get", CONTEXT_DOCUMENT.namespace, { description: "JSON-LD @context (namespace alias of haibun-context.jsonld)" }, jsonLdHandler);
	}
}
