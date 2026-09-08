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
import { hypermediaDomainMap, objectCoercer } from "@haibun/core/lib/domains.js";
import { presentedKeySchema, sessionCredentialSchema, type TPresentedKey } from "./session-schema.js";
import { actionOK, actionNotOK, actionOKWithProducts, getFromRuntime, getStepperOption, intOrError } from "@haibun/core/lib/util/index.js";
import type { TDeploymentSettings } from "./rpc-registry.js";
import { getAuthority } from "@haibun/core/lib/session-authority.js";
import { currentRequestBaseIri } from "@haibun/core/lib/request-context.js";
import { getJsonLdContext, relOf } from "@haibun/core/lib/hypermedia.js";
import { Access, haibunNsForHost, isPersisted, LinkRelations, type TPropertyDef } from "@haibun/core/lib/resources.js";
import { requestBaseIri } from "@haibun/core/lib/request-context.js";
import type { IWebServer } from "@haibun/web-server-hono/defs.js";
import { WEBSERVER } from "@haibun/web-server-hono/defs.js";
import type { Context } from "@haibun/web-server-hono/defs.js";
import { SHU_TYPE, SHU_TAG } from "./consts.js";
import type { IQuadStore, TQuad } from "@haibun/core/lib/quad-types.js";
import { buildGraphModelFromQuads } from "./graph-model.js";
import { withOntologySchema } from "./graph/ontology-projection.js";
import { enumerateStandardVocab } from "./graph/standard-vocabulary.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import type { IHasOptions } from "@haibun/core/lib/astepper.js";

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

const DOMAIN_SHU_VIEW_COLLECTION = "shu-view-collection";
const ShuViewCollectionSchema = z.object({
	view: z.string().optional(),
	views: z.array(z.object({ id: z.string(), description: z.string(), component: z.string() })),
});

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

/** The bundle for the standalone report: the minified production build (≈half the development build). Falls back to the
 *  development build if the report bundle is not built yet; neither carries a source map, which the served page adds. */
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
    /* The reader's own fonts: an app over private records asks nothing of a font service, and a page served here
       renders the same with no network at all. A named face is used where it is installed, the system's otherwise. */
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

// The served page's hydration is empty: a live page carries no boot payload. Only the offline report embeds one, and
// it writes its own hydration element (buildReportHtml). The tag is still served so the SSR shape is one shape.
export function buildSpaHtml(basePath: string, bundle: string, settings: TDeploymentSettings = {}): string {
	const hydration = Object.keys(settings).length > 0 ? JSON.stringify({ settings }) : "{}";
	const scripts = `  <script type="application/json" id="shu-hydration">${hydration}</script>\n\n  <script>${bundle}\n//# sourceMappingURL=${SPA_SOURCE_MAP}</script>`;
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

function createSpaHandler(basePath: string, settings: TDeploymentSettings) {
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
		return c.html(buildSpaHtml(basePath, loadBundle(), settings));
	};
}

/** How long a reader's credential holds. A session is a sitting, not a standing grant, so it lapses on its own. */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** The key a reader presents, as a declared domain: what the issuing step requires is in its own declaration, so the
 *  step listing and the generated input form carry it rather than the step checking a shape it never stated. */
export const DOMAIN_PRESENTED_KEY = "presented-key";

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
/** Where the served page's source map is read from. The bundle is inlined in the page, so the map is addressed
 *  absolutely rather than beside a file that is never fetched; only a reader with developer tools open asks for it. */
export const SPA_SOURCE_MAP = "/assets/shu-bundle.js.map";
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
		const timing = (option: string): number | undefined => {
			const set = getStepperOption(this, option, world.moduleOptions);
			return set === undefined ? undefined : Number(set);
		};
		this.settings = {
			...(timing("RUN_SHAPE_COUNTED_AFTER_MS") === undefined ? {} : { runShapeCountedAfterMs: timing("RUN_SHAPE_COUNTED_AFTER_MS") }),
			...(timing("STREAM_RECONNECT_AFTER_MS") === undefined ? {} : { streamReconnectAfterMs: timing("STREAM_RECONNECT_AFTER_MS") }),
		};
	}

	/**
	 * The credential a reader acts under, issued to a key that reader controls. The page proves control by signing what
	 * it asks; nothing secret is sent either way. What it may do is what the deployment declared, and it lapses with
	 * the session, so a page left open stops being able to act rather than holding authority for as long as it is open.
	 *
	 * What comes back is a proof, not a secret: the keyId names the reader's key so its signatures resolve, and is not
	 * kept anywhere it could be presented as authority in its own right. The session is not filed as a bearer grant,
	 * because the grants listing is what a bearer token resolves through, and the keyId is public — it rides every
	 * signed request and is written into the credential's own record. A reader's authority is the key it holds, proven
	 * per request, and nothing a third party can read stands in for it.
	 */
	private async sessionCredentialFor(holderKey: Record<string, unknown>, target: string): Promise<Record<string, unknown>> {
		// A deployment that declares nothing gives a reader nothing, which is an answer rather than a fault: what a
		// reader may do there needs no authority, so there is nothing to issue and nothing for a page to sign with.
		const allowedAction = sessionActions(this.sessionCapability);
		if (allowedAction.length === 0) return { allowedAction };
		const authority = getAuthority(this.getWorld().runtime);
		if (!authority) throw new Error("session credential: this run has no authority to issue from (load an authority stepper)");
		const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
		const { credential, keyId, record } = await authority.issueCredential({ holderKey, allowedAction, expires, target });
		return { keyId, credential, allowedAction, expires, record };
	}

	cycles = {
		// A feature gets a fresh web server, so the route this stepper adds to the previous one is gone with it: the flag
		// that stops a duplicate route within a feature must not outlive that feature, or the next one serves no bundle.
		startFeature: (): void => {
			this.viewBundleServed = false;
		},
		getConcerns: () => ({
			domains: [
				{
					selectors: [DOMAIN_PRESENTED_KEY],
					schema: presentedKeySchema,
					coerce: objectCoercer(presentedKeySchema),
					description: "The public half of a key a reader's page controls, as a JSON Web Key",
				},
				// Built-in shu views — registering them as domains makes them discoverable
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
				{ selectors: [SHU_TAG.MONITOR_COLUMN], schema: z.object({}), description: "Execution monitor and event log", ui: { component: SHU_TAG.MONITOR_COLUMN } },
				{ selectors: [SHU_TAG.DOCUMENT_COLUMN], schema: z.object({}), description: "Document/artifact viewer", ui: { component: SHU_TAG.DOCUMENT_COLUMN } },
				{
					selectors: [DOMAIN_SHU_VIEW_COLLECTION],
					schema: ShuViewCollectionSchema,
					description: "Catalog of registered views",
					ui: { component: SHU_TYPE.VIEW_COLLECTION, summary: "Available Views" },
				},
			],
		}),
	};

	/**
	 * What a reader of the served app may do, as actions the deployment declares. A reader is issued a credential
	 * holding them, bound to a key its own page controls, so whoever can reach the issuing step is given them: this is
	 * for a deployment that answers to its own readers (a session behind the site's own sign-in), not for an open
	 * port. Unset, nothing is issued and a reader can do only what needs no authority.
	 */
	options = {
		RUN_SHAPE_COUNTED_AFTER_MS: {
			desc: "How long after the run moves the page counts its shape again, in milliseconds (default 15000)",
			parse: (input: string) => intOrError(input),
		},
		STREAM_RECONNECT_AFTER_MS: {
			desc: "How long after the event stream breaks the page opens it again, in milliseconds (default 2000)",
			parse: (input: string) => intOrError(input),
		},
		SESSION_CAPABILITY: {
			// One process's own: a run this one starts serves its own app, from its own authority, and a session this run
			// issued means nothing there. Inherited, a child that has no authority to issue from failed at boot.
			perProcess: true,
			desc: "Actions a reader of the served app may take, comma-separated (a reader is issued a credential holding them, bound to a key its page controls). Unset, nothing is issued",
			parse: (input: string) => (sessionActions(input).length > 0 ? { result: input } : { parseError: "SESSION_CAPABILITY: name at least one action, comma-separated" }),
		},
	};
	/** SESSION_CAPABILITY as the deployment wrote it; `sessionActions` reads the actions out of it. */
	private sessionCapability?: string;
	/** The timings this deployment set, written into every page it serves. A deployment that sets neither serves a page
	 *  that runs on the values the product carries. */
	private settings: TDeploymentSettings = {};

	steps = {
		/**
		 * A reader's page presents the key it controls and receives what it may act with. This is the one interaction
		 * that cannot happen while the app is being served: the key is made in the page, after the page has loaded.
		 */
		issueSessionCredential: {
			gwta: `issue a session credential for the presented key {holderKey: ${DOMAIN_PRESENTED_KEY}}`,
			inputDomains: { holderKey: DOMAIN_PRESENTED_KEY },
			productsSchema: sessionCredentialSchema,
			action: async ({ holderKey }: { holderKey: TPresentedKey }) => {
				// What the reader is given authority over is the instance it is talking to, so every address it asks of is
				// under what it holds, and a credential cannot be carried to another instance.
				const target = currentRequestBaseIri();
				if (!target) return actionNotOK("issue a session credential: this was not asked over a request, so there is no instance to be given authority over");
				return actionOKWithProducts(await this.sessionCredentialFor(holderKey as Record<string, unknown>, target));
			},
		},
		serveShuApp: {
			gwta: "serve shu app at {path: string}",
			action: ({ path }: { path: string }) => {
				const webserver = getFromRuntime(this.getWorld().runtime, WEBSERVER) as IWebServer;
				if (!webserver) return actionNotOK("webserver not available — load web-server-stepper before shu");
				const pathError = validateMountPath(path);
				if (pathError) return actionNotOK(pathError);
				// The page boots with an empty payload and no credential: it makes its own key after loading and asks
				// issueSessionCredential for what this deployment lets a reader act under.
				webserver.addRoute("get", path, { description: `Shu SPA mounted at ${path}` }, createSpaHandler(path, this.settings));
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
					webserver.addRoute("get", SPA_SOURCE_MAP, { description: "Source map for the served shu bundle" }, (c: Context) => {
						try {
							c.header("Content-Type", "application/json");
							return c.body(readFileSync(join(__dirname, "..", "build", "shu-bundle.js.map"), "utf-8"));
						} catch {
							return c.body("the source map is not built; run npm run build in @haibun/shu", 404);
						}
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
		showPolymorphicGraphView: {
			gwta: "show polymorphic graph view",
			// Opened through the same affordance path as every other view: the products domain is the view's own, and the
			// step-hypermedia projection injects what mounts it from the registered declaration.
			productsDomain: SHU_TAG.POLYMORPHIC_GRAPH_VIEW,
			action: () => actionOKWithProducts({}),
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
