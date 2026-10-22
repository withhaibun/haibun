/**
 * ShuStepper: serves the @haibun/shu hypermedia SPA.
 * Any application that loads this stepper gets a UI driven entirely by stepper concerns.
 */
import { z } from "zod";
import { AStepper, type TStepperSteps, type IHasOptions } from "@haibun/core/lib/astepper.js";
import { actionOK, actionNotOK, actionOKWithProducts, errorDetail, getFromRuntime, getStepperOption, intOrError } from "@haibun/core/lib/domains/util.js";
import { RESPONSE_TIMEOUT_MS, type TDeploymentSettings, type TServedHydration } from "./domains/hydration.js";
import { getJsonLdContext } from "@haibun/core/lib/domains/hypermedia.js";
import { Access, haibunNsForHost, isPersisted } from "@haibun/core/lib/domains/resources.js";
import { requestBaseIri } from "@haibun/core/lib/request-context.js";
import { getAuthority } from "@haibun/core/lib/domains/session-authority.js";
import { WEBSERVER } from "@haibun/web-server-hono/domains/web-server.js";
import type { IWebServer, Context } from "@haibun/web-server-hono/defs.js";
import { CONTEXT_DOCUMENT, SHU_TYPE, SHU_TAG } from "./domains/elements.js";
import { DOMAIN_SHU_APPS, ShuAppsSchema } from "./domains/schemas.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import { DOMAIN_ROUTE } from "@haibun/core/lib/domains/domains.js";
import { labelFontResponse, servedBuild, servedPage } from "./pipelines/served-page.js";
import { LABEL_FONT, LABEL_FONT_FALLBACK_ROUTES, LABEL_FONT_FALLBACKS, PAGE_ASSETS, PAGE_CHUNKS, POLYMORPHIC_VIEW_JS } from "./domains/serving.js";
import { graphLayout } from "./pipelines/graph-source.js";
import { servedBundles } from "./root.js";
import type { TServedAsset } from "./ports.js";
import { BUNDLE_NAMES, bundleFileName } from "./domains/bundle-files.js";

/** The domain of where a graph view placed each node. */
const DOMAIN_GRAPH_LAYOUT = "graph-layout";
const DOMAIN_SHU_VIEW_COLLECTION = "shu-view-collection";
const ShuViewCollectionSchema = z.object({ view: z.string().optional(), views: z.array(z.object({ id: z.string(), description: z.string(), component: z.string() })) });

// Nodes and edges as pipe-delimited tokens, node `graph|subject|label`, edge `source|predicate|target`:
// so a feature can match a relationship without parsing the rendered graph (e.g. `matches g.edges with "*|discloses|*"`).
const GraphLayoutSchema = z.object({
	nodes: z.array(z.string()),
	edges: z.array(z.string()),
	clusters: z.array(z.object({ type: z.string(), total: z.number(), sampled: z.number() })),
});

/** What a deployment sets for the pages a ShuStepper serves, from its options. */
type TOptionSettings = Pick<TDeploymentSettings, "responseTimeoutMs" | "streamReconnectAfterMs" | "embedderOrigin" | "askToolLimit">;

/** The page's response. `no-store` forbids a cached copy, since the page carries the hydration of its request. */
function createSpaHandler(basePath: string, hydration: () => TServedHydration) {
	return (c: Context) => {
		const { html, policy } = servedPage(basePath, hydration());
		c.header("Cache-Control", "no-store, must-revalidate");
		c.header("Pragma", "no-cache");
		c.header("Content-Security-Policy", policy);
		return c.html(html);
	};
}

/** An Accept-Encoding header that accepts gzip. */
const GZIP = /\bgzip\b/;
/** The media type of a served bundle file, by its name's extension. */
const assetType = (path: string): string => (path.endsWith(".map") ? "application/json" : "application/javascript");

/** A served bundle file's response. The file is read on each request, so a rebuilt one is served after `npm run build`
 *  without a restart. `no-cache` revalidates it, so an unchanged file returns 304 and a rebuilt one gets a fresh ETag and a full
 *  body, gzipped where the request accepts gzip. */
function assetResponse(c: Context, asset: TServedAsset, path: string): Response {
	c.header("ETag", asset.etag);
	c.header("Cache-Control", "no-cache");
	c.header("Vary", "Accept-Encoding");
	if (c.req.header("if-none-match") === asset.etag) return c.body(null, 304);
	c.header("Content-Type", assetType(path));
	const accepted = c.req.header("accept-encoding");
	if (accepted === undefined || !GZIP.test(accepted)) return c.body(asset.content);
	c.header("Content-Encoding", "gzip");
	return c.body(asset.gzipped());
}

/** An origin as a page states it: a scheme and a host, such as `https://example.com` or `chrome-extension://<id>`. */
const ORIGIN = /^[a-z][a-z0-9+.-]*:\/\/[^/\s]+$/;

function validateMountPath(path: string): string | undefined {
	if (!path) return "path is required";
	if (!path.startsWith("/")) return 'path must start with "/"';
	if (path.length > 1 && path.endsWith("/")) return 'path must not end with "/"';
	return undefined;
}

export default class ShuStepper extends AStepper implements IHasOptions {
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
		// A served page loads the page's bundle, so a stepper without a built bundle refuses to start.
		servedBuild(servedBundles);
		this.settings = {
			responseTimeoutMs: responseTimeoutMs === undefined ? RESPONSE_TIMEOUT_MS : responseTimeoutMs,
			...(streamReconnectAfterMs === undefined ? {} : { streamReconnectAfterMs }),
			...(embedderOrigin === undefined ? {} : { embedderOrigin }),
			...(askToolLimit === undefined ? {} : { askToolLimit }),
		};
	}

	cycles = {
		startFeature: (): void => {
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
						jsContent: servedBundles.whole(bundleFileName(BUNDLE_NAMES.polymorphic)),
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
						jsContent: servedBundles.whole(bundleFileName(BUNDLE_NAMES.polymorphic)),
						summary: "Class browser",
						// The site's schema presenter: the type column embeds this for its schema view.
						presents: "schema",
					},
				},
				{ selectors: [SHU_TAG.MONITOR_COLUMN], schema: z.object({}), description: "Actuality's monitor and event log", ui: { component: SHU_TAG.MONITOR_COLUMN } },
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
			desc: `How long a call to this site may take before the page reads it as not responding and reads what the device holds, in milliseconds. Unset, the page allows ${RESPONSE_TIMEOUT_MS}`,
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
	/** The timings and the embedding page's origin this deployment set, written into every page it serves, or undefined
	 *  until the stepper reads its options. */
	private settings: TOptionSettings | undefined = undefined;

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
				try {
					return actionOKWithProducts(await graphLayout(this.getWorld()));
				} catch (err) {
					return actionNotOK(`get graph layout: ${errorDetail(err)}`);
				}
			},
		},
	} as const satisfies TStepperSteps;

	/** Serve the app on a server at a path, with the view bundle, its source map and the JSON-LD context the page reads.
	 *  `opensAt` is the address a reader who arrives without one is shown, where actuality hasn't shown a view of its own. */
	serveApp(webserver: IWebServer, path: string, opensAt?: string): void {
		// The page boots with the actualityId of the records it reads and what this deployment set: it keeps its own key, and
		// reads what was delegated to it here. Whether a delegation verifies here is read for each page served, since a
		// verifier may be registered after the app is.
		const { settings } = this;
		if (settings === undefined) throw new Error("serveApp is called after ShuStepper reads its options in setWorld");
		const hydration = (): TServedHydration => ({
			actualityId: this.getWorld().runtime.actualityId,
			settings: {
				...settings,
				build: servedBuild(servedBundles),
				allowedWithoutDelegation: [...webserver.allowedWithoutDelegation],
				verifiesDelegations: getAuthority(this.getWorld().runtime)?.hasVerifier() === true,
			},
			...(opensAt ? { viewHash: opensAt } : {}),
		});
		webserver.addRoute("get", path, { description: `Shu SPA mounted at ${path}` }, createSpaHandler(path, hydration));
		// The context is built from the domains as they stand, so a type declared after the page was served is in it, and for
		// the host the request names, which a caller writes, so the handler doesn't keep anything per host.
		const jsonLdHandler = (c: Context) => c.json(getJsonLdContext(this.getWorld().domains, haibunNsForHost(requestBaseIri(c.req.header()))));
		// What every app of a server shares is served once per server, however many apps it mounts: the page's bundles with their
		// chunks and source maps, and the JSON-LD context.
		for (const route of [`${PAGE_ASSETS}/:file`, `${PAGE_CHUNKS}/:file`])
			webserver.addRouteIfAbsent("get", route, { description: "The page's bundles, the graph view's among them, their chunks and their source maps" }, (c: Context) => {
				const path = c.req.path.slice(PAGE_ASSETS.length + 1);
				const asset = servedBundles.pageFile(path);
				if (asset === undefined) return c.body(`${path} isn't a file of the page's present build. Reload the page, which names the present build's files.`, 404);
				return assetResponse(c, asset, path);
			});
		webserver.addRouteIfAbsent("get", LABEL_FONT, { description: "The font of the graph's labels" }, (c: Context) => {
			c.header("Content-Type", "font/woff");
			c.header("Cache-Control", "max-age=86400");
			return c.body(servedBundles.labelFont());
		});
		for (const route of LABEL_FONT_FALLBACK_ROUTES)
			webserver.addRouteIfAbsent("get", `${LABEL_FONT_FALLBACKS}/${route}`, { description: "The fallback fonts of the graph's labels" }, (c: Context) => {
				const response = labelFontResponse(servedBundles, c.req.path.slice(LABEL_FONT_FALLBACKS.length + 1));
				if (response === undefined) return c.body(null, 404);
				if ("json" in response) return c.json(response.json);
				c.header("Content-Type", "font/woff");
				return c.body(response.font);
			});
		webserver.addRouteIfAbsent("get", CONTEXT_DOCUMENT.wellKnown, { description: "JSON-LD @context for haibun domain vocabulary" }, jsonLdHandler);
		webserver.addRouteIfAbsent("get", CONTEXT_DOCUMENT.namespace, { description: "JSON-LD @context (namespace alias of haibun-context.jsonld)" }, jsonLdHandler);
	}
}
