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
import { getJsonLdContext } from "@haibun/core/lib/hypermedia.js";
import type { IWebServer } from "@haibun/web-server-hono/defs.js";
import { WEBSERVER } from "@haibun/web-server-hono/defs.js";
import type { Context } from "@haibun/web-server-hono/defs.js";
import { HYPERMEDIA } from "@haibun/core/schema/protocol.js";
import { SHU_TYPE } from "./consts.js";

export const DOMAIN_SHU_VIEW_ID = "shu-view-id";
const ShuViewIdSchema = z.string();

const __dirname = dirname(fileURLToPath(import.meta.url));

export function loadBundle(): string {
	const bundlePath = join(__dirname, "..", "build", "shu-bundle.js");
	try {
		return readFileSync(bundlePath, "utf-8");
	} catch {
		return 'document.getElementById("shu-main").innerHTML = "<div>SPA bundle not found. Run: npm run build in @haibun/shu</div>";';
	}
}

export function buildSpaHtml(basePath: string, bundle: string, hydration: string, extraScripts: string[] = []): string {
	const extraTags = extraScripts.filter((s) => s.length > 0).map((s) => `  <script>${s.replaceAll("</", "<\\/")}</script>`).join("\n");
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
  <script type="application/json" id="shu-hydration">${hydration.replaceAll("</", "<\\/")}</script>
${extraTags}
  <script>${bundle}</script>
</body>
</html>`;
}

function createSpaHandler(basePath: string, bundle: string, hydration: string) {
	return (c: Context) => c.html(buildSpaHtml(basePath, bundle, hydration));
}

function validateMountPath(path: string): string | undefined {
	if (!path) return "path is required";
	if (!path.startsWith("/")) return 'path must start with "/"';
	if (path.length > 1 && path.endsWith("/")) return 'path must not end with "/"';
	return undefined;
}

export default class ShuStepper extends AStepper {
	description = "Serves the @haibun/shu hypermedia SPA at a given path";

	cycles = {
		getConcerns: () => ({
			domains: [{ selectors: [DOMAIN_SHU_VIEW_ID], schema: ShuViewIdSchema, description: "Shu view id" }],
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
				const bundle = loadBundle();
				webserver.addRoute("get", path, { description: `Shu SPA mounted at ${path}` }, createSpaHandler(path, bundle, "{}"));
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
			outputSchema: z.object({ views: z.array(z.object({ id: z.string(), description: z.string(), component: z.string() })) }),
			action: () => {
				const domains = this.getWorld().domains;
				const views = Object.values(domains)
					.filter((d) => typeof d.ui?.component === "string")
					.map((d) => ({
						id: d.topology?.vertexLabel || d.selectors[0],
						description: d.description || d.selectors[0],
						component: String(d.ui?.component),
					}));
				return actionOKWithProducts({ [HYPERMEDIA.TYPE]: SHU_TYPE.VIEW_COLLECTION, [HYPERMEDIA.SUMMARY]: "Available Views", view: "views", views });
			},
		},
		closeView: {
			gwta: `close view {id: ${DOMAIN_SHU_VIEW_ID}}`,
			action: ({ id }: { id: string }) => actionOKWithProducts({ [HYPERMEDIA.TYPE]: SHU_TYPE.CLOSE_VIEW, view: id }),
		},
	} satisfies TStepperSteps;
}
