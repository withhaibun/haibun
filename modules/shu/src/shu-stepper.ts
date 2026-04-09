/**
 * ShuStepper — serves the @haibun/shu hypermedia SPA.
 * Any application that loads this stepper gets a UI driven entirely by stepper concerns.
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import { AStepper, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import { actionOK, actionNotOK, actionOKWithProducts, getFromRuntime } from "@haibun/core/lib/util/index.js";
import { getRel, type TPropertyDef, type TRegisteredDomain } from "@haibun/core/lib/defs.js";
import { buildConcernCatalog, getJsonLdContext } from "@haibun/core/lib/hypermedia.js";
import type { IWebServer } from "@haibun/web-server-hono/defs.js";
import { WEBSERVER } from "@haibun/web-server-hono/defs.js";
import type { Context } from "@haibun/web-server-hono/defs.js";
import { buildMermaidSource, buildClassifier, DEFAULT_MAX_PER_SUBGRAPH } from "./mermaid-source.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadBundle(): string {
	const bundlePath = join(__dirname, "..", "build", "shu-bundle.js");
	try {
		return readFileSync(bundlePath, "utf-8");
	} catch {
		return 'document.getElementById("shu-main").innerHTML = "<div>SPA bundle not found. Run: npm run build in @haibun/shu</div>";';
	}
}

function createSpaHandler(basePath: string, bundle: string, hydration: string) {
	return (c: Context) => {
		const html = `<!DOCTYPE html>
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
  <script type="application/json" id="shu-hydration">${hydration}</script>
  <script>${bundle}</script>
</body>
</html>`;
		return c.html(html);
	};
}

function validateMountPath(path: string): string | undefined {
	if (!path) return "path is required";
	if (!path.startsWith("/")) return 'path must start with "/"';
	if (path.length > 1 && path.endsWith("/")) return 'path must not end with "/"';
	return undefined;
}

export default class ShuStepper extends AStepper {
	description = "Serves the @haibun/shu hypermedia SPA at a given path";
	private mountedPath?: string;

	steps = {
		serveShuApp: {
			gwta: "serve shu app at {path: string}",
			action: ({ path }: { path: string }) => {
				const webserver = getFromRuntime(this.getWorld().runtime, WEBSERVER) as IWebServer;
				if (!webserver) return actionNotOK("webserver not available — load web-server-stepper before shu");
				const pathError = validateMountPath(path);
				if (pathError) return actionNotOK(pathError);
				if (this.mountedPath === path) return actionOK();
				if (this.mountedPath) return actionNotOK(`shu app already mounted at "${this.mountedPath}"; cannot mount at different path "${path}"`);
				const bundle = loadBundle();
				const hydrationJson = JSON.stringify({
					concerns: buildConcernCatalog(this.getWorld().domains),
				});
				webserver.addRoute("get", path, createSpaHandler(path, bundle, hydrationJson));
				const jsonLdContext = getJsonLdContext(this.getWorld().domains);
				const jsonLdHandler = (c: Context) => c.json(jsonLdContext);
				webserver.addRoute("get", "/.well-known/shu-context.jsonld", jsonLdHandler);
				webserver.addRoute("get", "/ns/context.jsonld", jsonLdHandler);
				this.mountedPath = path;
				return actionOK();
			},
		},
		exportMermaid: {
			gwta: "export mermaid",
			outputSchema: z.object({ mermaid: z.string() }),
			action: async () => {
				const store = this.getWorld().shared?.getStore();
				if (!store) return actionNotOK("No quad store available");
				const quads = await store.query({});
				const classifier = buildServerClassifier(this.getWorld().domains);
				const opts = { layout: "TD" as const, hiddenGraphs: new Set<string>(), expandedGraphs: new Set<string>(), maxPerSubgraph: DEFAULT_MAX_PER_SUBGRAPH };
				const { source } = buildMermaidSource(quads, opts, classifier);
				return actionOKWithProducts({ mermaid: source });
			},
		},
	} satisfies TStepperSteps;
}

/** Build a PropertyClassifier from world.domains metadata (server-side equivalent of browser rels-cache). */
function buildServerClassifier(domains: Record<string, TRegisteredDomain>) {
	const relsMap = new Map<string, Record<string, string>>();
	const edgeRangesMap = new Map<string, Record<string, string>>();
	const stepperMap = new Map<string, string>();
	const allEdgeRels: Record<string, string> = {};

	for (const domain of Object.values(domains)) {
		const meta = domain.meta;
		if (!meta?.vertexLabel) continue;
		const label = meta.vertexLabel;
		if (domain.stepperName) stepperMap.set(label, domain.stepperName);
		const rels: Record<string, string> = {};
		for (const [field, def] of Object.entries(meta.properties ?? {})) {
			rels[field] = getRel(def as TPropertyDef);
		}
		relsMap.set(label, rels);
		const ranges: Record<string, string> = {};
		const edgeRelRecord: Record<string, string> = {};
		for (const [field, edgeDef] of Object.entries(meta.edges ?? {})) {
			ranges[field] = edgeDef.range;
			edgeRelRecord[field] = edgeDef.rel;
		}
		edgeRangesMap.set(label, ranges);
		Object.assign(allEdgeRels, edgeRelRecord);
	}

	return buildClassifier(
		(graph) => relsMap.get(graph),
		(graph) => edgeRangesMap.get(graph),
		(label) => stepperMap.get(label),
		allEdgeRels,
	);
}
