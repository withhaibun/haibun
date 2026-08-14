/**
 * ShuStepper — serves the @haibun/shu hypermedia SPA.
 * Any application that loads this stepper gets a UI driven entirely by stepper concerns.
 */
import { readFileSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { gzipSync } from "node:zlib";
import { z } from "zod";
import { AStepper, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import { hypermediaDomainMap } from "@haibun/core/lib/domains.js";
import { actionOK, actionNotOK, actionOKWithProducts, getFromRuntime, getStepperOption } from "@haibun/core/lib/util/index.js";
import { randomUUID } from "node:crypto";
import { getZcapAuthority } from "@haibun/core/lib/zcap-authority.js";
import { activeSitePrincipal } from "@haibun/core/lib/host-id.js";
import { formatSeqPath } from "@haibun/core/lib/seq-path.js";
import { getJsonLdContext, relOf } from "@haibun/core/lib/hypermedia.js";
import { Access, haibunNsForHost, isPersisted, LinkRelations, type TPropertyDef } from "@haibun/core/lib/resources.js";
import { requestBaseIri } from "@haibun/core/lib/request-context.js";
import type { IWebServer } from "@haibun/web-server-hono/defs.js";
import { WEBSERVER } from "@haibun/web-server-hono/defs.js";
import type { Context } from "@haibun/web-server-hono/defs.js";
import { SHU_TYPE } from "./consts.js";
import type { IQuadStore, TQuad } from "@haibun/core/lib/quad-types.js";
import { buildGraphModelFromQuads } from "./graph-model.js";
import { withOntologySchema } from "./graph/ontology-projection.js";
import { enumerateStandardVocab } from "./graph/standard-vocabulary.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import type { IHasOptions, TFeatureStep } from "@haibun/core/lib/astepper.js";

/**
 * Project the persisted quads into the renderer-agnostic graph model (nodes + typed-reference edges) the SPA also
 * builds client-side. The one place the server reproduces it: `get graph layout` reads the node/edge sets back, and the
 * offline report serializes the quad snapshot. The FULL snapshot is serialized — instrumentation included — exactly like
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
	// Scope "own": the standalone report is this site's own record — a shutdown-time capture must not depend on
	// federated peers still being reachable, and each peer's record is its own report.
	const raw = await store.getClusteredQuads({ perTypeLimit: 10000, accessLevel: Access.private, scope: "own" });
	// Include the schema exactly as the live getClusteredQuads does, so the offline report's ontology/class-browser view
	// matches live — pruned against the serialized graph itself (the report IS the full data). The one assembler, no drift.
	const standardVocab = await enumerateStandardVocab(world.domains);
	const { quads, clusters } = withOntologySchema({ quads: raw.quads as TQuad[], clusters: raw.clusters }, raw.quads as TQuad[], world.domains, standardVocab);
	const model = buildGraphModelFromQuads(quads as TQuad[]);
	const nodeMap = new Map(model.nodes.map((n) => [n.id, { graph: n.type, subject: n.id }]));
	const edges = model.edges.map((e) => ({ source: e.from, predicate: e.predicate, object: e.to }));
	return { quads: quads as TQuad[], clusters, nodeMap, edges };
}

export const DOMAIN_SHU_VIEW_ID = "shu-view-id";
const DOMAIN_SHU_VIEW_COLLECTION = "shu-view-collection";
const DOMAIN_SHU_VIEW_CLOSE = "shu-view-close";
const ShuViewIdSchema = z.string();
const ShuViewCollectionSchema = z.object({
	view: z.string().optional(),
	views: z.array(z.object({ id: z.string(), description: z.string(), component: z.string() })),
});
const ShuViewCloseSchema = z.object({ view: z.string() });
const ShuSelectValuesSchema = z.object({ values: z.record(z.string(), z.array(z.string())) });

// Nodes and edges as pipe-delimited tokens — node `graph|subject|label`, edge `source|predicate|target` —
// so a feature can match a relationship without parsing the rendered graph (e.g. `matches g.edges with "*|discloses|*"`).
const GraphLayoutSchema = z.object({
	nodes: z.array(z.string()),
	edges: z.array(z.string()),
	clusters: z.array(z.object({ type: z.string(), total: z.number(), sampled: z.number() })),
});

const __dirname = dirname(fileURLToPath(import.meta.url));

export function loadBundle(): string {
	const bundlePath = join(__dirname, "..", "build", "shu-bundle.js");
	try {
		return readFileSync(bundlePath, "utf-8");
	} catch {
		return 'document.getElementById("shu-main").innerHTML = "<div>SPA bundle not found. Run: npm run build in @haibun/shu</div>";';
	}
}

/** The bundle for the standalone report: the minified production build (≈half the dev bundle, no sourcemap). Falls back to the sourcemap-stripped dev bundle if the report bundle isn't built yet. */
export function loadReportBundle(): string {
	try {
		return readFileSync(join(__dirname, "..", "build", "shu-report-bundle.js"), "utf-8");
	} catch {
		return loadBundle().replace(/\n?\/\/# sourceMappingURL=data:application\/json;[^\n]*/g, "");
	}
}

function spaDocument(basePath: string, scriptsHtml: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Haibun</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;500;600&family=Source+Code+Pro:wght@400;500&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; overflow: hidden; }
    body { font-family: "Source Sans 3", "Source Code Pro", sans-serif; }
    code, pre, table, td, th { font-family: "Source Code Pro", monospace; }
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

export function buildSpaHtml(basePath: string, bundle: string, hydration: string, extraScripts: string[] = []): string {
	const extraTags = extraScripts
		.filter((s) => s.length > 0)
		.map((s) => `  <script>${s.replaceAll("</", "<\\/")}</script>`)
		.join("\n");
	const scripts = `  <script type="application/json" id="shu-hydration">${hydration.replaceAll("</", "<\\/")}</script>\n${extraTags}\n  <script>${bundle}</script>`;
	return spaDocument(basePath, scripts);
}

/**
 * Offline report: a `{bundle, hydration, scripts}` payload plus a tiny loader that recreates the `#shu-hydration` script
 * the bundle reads, injects the in-view component scripts, then the bundle (which boots via app.ts's readyState check).
 * `compressed` embeds the payload as gzip+base64 to keep shared files small (base64 needs no `</` escaping); uncompressed
 * embeds plain JSON (only `</` escaped) so the redacted text can be read and audited directly in the file — the
 * secret-obscuring check greps it.
 */
export function buildReportHtml(basePath: string, payload: string, compressed: boolean): string {
	const inject = `const h = document.createElement("script"); h.type = "application/json"; h.id = "shu-hydration"; h.textContent = hydration; document.body.appendChild(h);
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

function createSpaHandler(basePath: string, hydration: string) {
	// Read the bundle from disk on every request rather than caching it at
	// handler construction, so a rebuilt shu-bundle.js is served after
	// `npm run build` + reload with no service restart. The ~3.7MB readFileSync
	// is sub-ms on a warm cache.
	// `no-store` is required because the bundle is inlined in the HTML response:
	// `no-cache` still permits cached storage with revalidation, so a soft reload
	// could keep serving a stale bundle; `no-store` forbids caching entirely.
	return (c: Context) => {
		c.header("Cache-Control", "no-store, must-revalidate");
		c.header("Pragma", "no-cache");
		return c.html(buildSpaHtml(basePath, loadBundle(), hydration));
	};
}

/** The actions SESSION_CAPABILITY names, read from what the deployment wrote. One reader, used by the option's own
 *  check and by the serving, so what is accepted at boot and what is issued at serve cannot differ. */
export function sessionActions(declared: string | undefined): string[] {
	return (declared ?? "")
		.split(",")
		.map((action) => action.trim())
		.filter((action) => action.length > 0);
}


// The graph view's bundled IIFE, under build/assets/ so tsc's per-file ESM emit cannot clobber it. Anchored at the
// package root so one path resolves whether this runs from `src/` or `build/`, and cached by mtime so a rebuilt
// bundle is served on the next request.
export const POLYMORPHIC_VIEW_JS = "/assets/shu-polymorphic-graph-view.js";
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
	/** One route per host for the view bundle, however many apps are mounted. */
	private viewBundleServed = false;
	description = "Serves the @haibun/shu hypermedia SPA at a given path";

	async setWorld(world: TWorld, steppers: AStepper[]): Promise<void> {
		await super.setWorld(world, steppers);
		this.sessionCapability = getStepperOption(this, "SESSION_CAPABILITY", world.moduleOptions) as string | undefined;
	}

	/** What the page boots with: the credential a reader acts under, where the deployment declared one. The token is
	 *  registered with this run's own authority, so it holds exactly the declared actions and dies with the run. */
	private sessionHydration(seqPath: string): Record<string, unknown> {
		const allowedAction = sessionActions(this.sessionCapability);
		if (allowedAction.length === 0) return {};
		const authority = getZcapAuthority(this.getWorld().runtime);
		if (!authority) throw new Error("serve shu app: SESSION_CAPABILITY names actions, but this run has no authority to issue them from");
		const token = `shu-session-${randomUUID()}`;
		authority.issueBearerGrant({ token, allowedAction, controller: activeSitePrincipal(this.getWorld()), note: "the served app's own session", seqPath });
		return { session: { token, allowedAction } };
	}

	cycles = {
		// A feature gets a fresh web server, so the route this stepper adds to the previous one is gone with it: the flag
		// that stops a duplicate route within a feature must not outlive that feature, or the next one serves no bundle.
		startFeature: (): void => {
			this.viewBundleServed = false;
		},
		getConcerns: () => ({
			domains: [
				{ selectors: [DOMAIN_SHU_VIEW_ID], schema: ShuViewIdSchema, description: "Shu view id" },
				// Built-in shu views — registering them as domains makes them discoverable
				// via `show views` (the picker iterates domains with `ui.component`).
				// External steppers register their own view domains the same way.
				{
					selectors: ["shu-polymorphic-graph-view"],
					schema: z.object({}),
					description: "The polymorphic graph view: one graph as a force cloud, a layered flow, a gantt or a sequence",
					ui: {
						component: "shu-polymorphic-graph-view",
						js: POLYMORPHIC_VIEW_JS,
						jsContent: loadPolymorphicBundle().content,
						summary: "Graph view",
						pinnedOnly: true,
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
						// Defined in the SAME bundle as the graph view — one served asset registers both.
						js: POLYMORPHIC_VIEW_JS,
						jsContent: loadPolymorphicBundle().content,
						summary: "Class browser",
						pinnedOnly: true,
						// The site's schema presenter: the type column embeds this for its schema view.
						presents: "schema",
					},
				},
				{ selectors: ["shu-monitor-column"], schema: z.object({}), description: "Execution monitor and event log", ui: { component: "shu-monitor-column" } },
				{ selectors: ["shu-document-column"], schema: z.object({}), description: "Document/artifact viewer", ui: { component: "shu-document-column" } },
				{
					selectors: [DOMAIN_SHU_VIEW_COLLECTION],
					schema: ShuViewCollectionSchema,
					description: "Catalog of registered views",
					ui: { component: SHU_TYPE.VIEW_COLLECTION, summary: "Available Views" },
				},
				{
					selectors: [DOMAIN_SHU_VIEW_CLOSE],
					schema: ShuViewCloseSchema,
					description: "Request to close a view",
					ui: { component: SHU_TYPE.CLOSE_VIEW },
				},
			],
		}),
	};

	/**
	 * What a reader of the served app may do, as actions the deployment declares. A page carries the credential that
	 * holds them, so whoever can fetch the page holds them: this is for a deployment that answers to its own readers
	 * (a session behind the site's own sign-in), not for an open port. Unset, the page carries no credential and a
	 * reader can do only what needs none.
	 */
	options = {
		SESSION_CAPABILITY: {
			// One process's own: a run this one starts serves its own app, from its own authority, and a session this run
			// issued means nothing there. Inherited, a child that has no authority to issue from failed at boot.
			perProcess: true,
			desc: "Actions a reader of the served app may take, comma-separated (the app's page carries the credential holding them, so anyone who can fetch the page holds them). Unset, the page carries none",
			parse: (input: string) => (sessionActions(input).length > 0 ? { result: input } : { parseError: "SESSION_CAPABILITY: name at least one action, comma-separated" }),
		},
	};
	/** SESSION_CAPABILITY as the deployment wrote it; `sessionActions` reads the actions out of it. */
	private sessionCapability?: string;

	steps = {
		serveShuApp: {
			gwta: "serve shu app at {path: string}",
			action: ({ path }: { path: string }, featureStep: TFeatureStep) => {
				const webserver = getFromRuntime(this.getWorld().runtime, WEBSERVER) as IWebServer;
				if (!webserver) return actionNotOK("webserver not available — load web-server-stepper before shu");
				const pathError = validateMountPath(path);
				if (pathError) return actionNotOK(pathError);
				// The page is served with the credential its reader acts under, in the payload the page already boots from.
				// A fresh token per serving, held by the run's own authority, so it is gone when the run is.
				webserver.addRoute("get", path, { description: `Shu SPA mounted at ${path}` }, createSpaHandler(path, JSON.stringify(this.sessionHydration(formatSeqPath(featureStep.seqPath)))));
				const domains = this.getWorld().domains;
				// The context varies only by serving host, drawn from a tiny set of origins — build it once per host.
				const byHost = new Map<string, Record<string, unknown>>();
				const jsonLdHandler = (c: Context) => {
					const ns = haibunNsForHost(requestBaseIri(c.req.header()));
					let ctx = byHost.get(ns);
					if (!ctx) byHost.set(ns, (ctx = getJsonLdContext(domains, ns)));
					return c.json(ctx);
				};
				// The graph view's bundle, served once per host: `no-cache` revalidates, so an unchanged bundle answers 304
				// and a rebuilt one gets a fresh ETag and a full body.
				if (!this.viewBundleServed) {
					this.viewBundleServed = true;
					webserver.addRoute("get", POLYMORPHIC_VIEW_JS, { description: "The polymorphic graph view and the class browser" }, (c: Context) => {
						const { content, etag } = loadPolymorphicBundle();
						c.header("ETag", etag);
						c.header("Cache-Control", "no-cache");
						if (c.req.header("if-none-match") === etag) return c.body(null, 304);
						c.header("Content-Type", "application/javascript");
						return c.body(content);
					});
				}
				webserver.addRoute("get", "/.well-known/haibun-context.jsonld", { description: "JSON-LD @context for haibun domain vocabulary" }, jsonLdHandler);
				webserver.addRoute("get", "/ns/context.jsonld", { description: "JSON-LD @context (namespace alias of haibun-context.jsonld)" }, jsonLdHandler);
				return actionOK();
			},
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
		getSelectValues: {
			gwta: "get select values for {label: string}",
			productsSchema: ShuSelectValuesSchema,
			action: async ({ label }: { label: string }) => {
				const store = this.getWorld().shared.getStore() as IQuadStore;
				const domain = hypermediaDomainMap(this.getWorld().domains).get(label);
				if (!domain?.topology?.properties) return actionNotOK(`No filter topology registered for ${label}`);
				const values: Record<string, string[]> = {};
				for (const [property, definition] of Object.entries(domain.topology.properties)) {
					if (relOf(definition) === LinkRelations.CONTEXT.rel) values[property] = await store.distinctPropertyValues(label, property);
				}
				return actionOKWithProducts({ values });
			},
		},
		showPolymorphicGraphView: {
			gwta: "show polymorphic graph view",
			// Opened through the same affordance path as every other view: the products domain is the view's own, and the
			// step-hypermedia projection injects what mounts it from the registered declaration.
			productsDomain: "shu-polymorphic-graph-view",
			action: () => actionOKWithProducts({}),
		},
		closeView: {
			gwta: `close view {id: ${DOMAIN_SHU_VIEW_ID}}`,
			productsDomain: DOMAIN_SHU_VIEW_CLOSE,
			action: ({ id }: { id: string }) => actionOKWithProducts({ view: id }),
		},
		getGraphLayout: {
			gwta: "get graph layout",
			productsSchema: GraphLayoutSchema,
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
	} satisfies TStepperSteps;
}
