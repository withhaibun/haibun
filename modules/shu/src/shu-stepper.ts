/**
 * ShuStepper — serves the @haibun/shu hypermedia SPA.
 * Any application that loads this stepper gets a UI driven entirely by stepper concerns.
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { gzipSync } from "node:zlib";
import { z } from "zod";
import { AStepper, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import { hypermediaDomainMap } from "@haibun/core/lib/domains.js";
import { actionOK, actionNotOK, actionOKWithProducts, getFromRuntime } from "@haibun/core/lib/util/index.js";
import { getJsonLdContext } from "@haibun/core/lib/hypermedia.js";
import { Access, isContentPropertyDef, isPersisted, LinkRelations, type TPropertyDef } from "@haibun/core/lib/resources.js";
import type { IWebServer } from "@haibun/web-server-hono/defs.js";
import { WEBSERVER } from "@haibun/web-server-hono/defs.js";
import type { Context } from "@haibun/web-server-hono/defs.js";
import { SHU_TYPE } from "./consts.js";
import type { IQuadStore, TQuad } from "@haibun/core/lib/quad-types.js";
import { buildGraphModelFromQuads } from "./graph-model.js";
import type { TWorld } from "@haibun/core/lib/world.js";

/**
 * Project the persisted quads into the renderer-agnostic graph model (nodes + typed-reference edges) the SPA also
 * builds client-side. The one place the server reproduces it: `get graph layout` reads the node/edge sets back, and the
 * offline report bakes the quad snapshot. The FULL snapshot is baked — instrumentation included — exactly like the live
 * getClusteredQuads RPC; the view hides instrumentation by default (toggleable) via effectiveHiddenTypes, so the offline
 * report behaves identically to live.
 */
export async function buildGraphSource(
	world: TWorld,
): Promise<
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
	// Scope "own": the standalone report is this site's own record — a shutdown-time bake must not depend on
	// federated peers still being reachable, and each peer's record is its own report.
	const { quads, clusters } = await store.getClusteredQuads({ perTypeLimit: 10000, accessLevel: Access.private, scope: "own" });
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

function validateMountPath(path: string): string | undefined {
	if (!path) return "path is required";
	if (!path.startsWith("/")) return 'path must start with "/"';
	if (path.length > 1 && path.endsWith("/")) return 'path must not end with "/"';
	return undefined;
}

function enumValuesFromJsonSchema(jsonSchema: unknown): string[] {
	if (!jsonSchema || typeof jsonSchema !== "object") return [];
	const schema = jsonSchema as { enum?: unknown[]; anyOf?: unknown[]; oneOf?: unknown[] };
	const direct = schema.enum?.filter((value): value is string => typeof value === "string") ?? [];
	if (direct.length > 0) return direct;
	for (const branch of [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])]) {
		const nested = enumValuesFromJsonSchema(branch);
		if (nested.length > 0) return nested;
	}
	return [];
}

function selectValuesFromSchema(schema: z.ZodType, properties: Record<string, TPropertyDef>, filterProperties: string[] = []): Record<string, string[]> {
	const values: Record<string, string[]> = {};
	if (!(schema instanceof z.ZodObject)) return values;
	const selectableProperties = new Set(filterProperties);
	for (const [field, fieldSchema] of Object.entries(schema.shape)) {
		const def = properties[field];
		if (!def || !selectableProperties.has(field) || relOf(def) === LinkRelations.IDENTIFIER.rel) continue;
		try {
			const fieldValues = enumValuesFromJsonSchema(z.toJSONSchema(fieldSchema));
			if (fieldValues.length > 0) values[field] = fieldValues;
		} catch {
			continue;
		}
	}
	return values;
}

function relOf(def: TPropertyDef): string {
	return isContentPropertyDef(def) ? def.rel : def;
}

export default class ShuStepper extends AStepper {
	description = "Serves the @haibun/shu hypermedia SPA at a given path";

	cycles = {
		getConcerns: () => ({
			domains: [
				{ selectors: [DOMAIN_SHU_VIEW_ID], schema: ShuViewIdSchema, description: "Shu view id" },
				// Built-in shu views — registering them as domains makes them discoverable
				// via `show views` (the picker iterates domains with `ui.component`).
				// External steppers register their own view domains the same way.
				{ selectors: ["shu-graph-view"], schema: z.object({}), description: "Quad-store graph", ui: { component: "shu-graph-view" } },
				{ selectors: ["shu-monitor-column"], schema: z.object({}), description: "Execution monitor and event log", ui: { component: "shu-monitor-column" } },
				{ selectors: ["shu-sequence-diagram"], schema: z.object({}), description: "Sequence diagram of step trace", ui: { component: "shu-sequence-diagram" } },
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

	steps = {
		serveShuApp: {
			gwta: "serve shu app at {path: string}",
			action: ({ path }: { path: string }) => {
				const webserver = getFromRuntime(this.getWorld().runtime, WEBSERVER) as IWebServer;
				if (!webserver) return actionNotOK("webserver not available — load web-server-stepper before shu");
				const pathError = validateMountPath(path);
				if (pathError) return actionNotOK(pathError);
				webserver.addRoute("get", path, { description: `Shu SPA mounted at ${path}` }, createSpaHandler(path, "{}"));
				const jsonLdContext = getJsonLdContext(this.getWorld().domains);
				const jsonLdHandler = (c: Context) => c.json(jsonLdContext);
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
				Object.assign(values, selectValuesFromSchema(domain.schema, domain.topology.properties, domain.topology.filterProperties));
				for (const [property, definition] of Object.entries(domain.topology.properties)) {
					if (relOf(definition) === LinkRelations.CONTEXT.rel) values[property] = await store.distinctPropertyValues(label, property);
				}
				return actionOKWithProducts({ values });
			},
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
