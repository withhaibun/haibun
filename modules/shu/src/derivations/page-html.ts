/**
 * The documents shu serves: the page a server serves, which loads its bundle, the standalone report that carries its
 * bundle and hydration as a payload, and the component scripts a report inlines.
 */
import { MEDIA_TYPE } from "@haibun/core/lib/domains/media-types.js";
import { HYDRATION_ID } from "../domains/elements.js";
import type { TServedHydration } from "../domains/hydration.js";
import { PAGE_BUNDLE_JS } from "../domains/serving.js";

/** The document around the page's scripts: the app's mount point, into which the bundle renders. */
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

/** The page a server serves: its hydration element, and its bundle loaded as a module under the response's script nonce. */
export function buildSpaHtml(basePath: string, hydration: TServedHydration, nonce: string): string {
	const scripts = `  <script type="${MEDIA_TYPE.json}" id="${HYDRATION_ID}">${JSON.stringify(hydration)}</script>\n\n  <script type="module" nonce="${nonce}" src="${PAGE_BUNDLE_JS}"></script>`;
	return spaDocument(basePath, scripts);
}

/**
 * The standalone report: a `{bundle, hydration, scripts}` payload and a loader that adds the hydration element the bundle
 * reads, the components' scripts, and then the bundle, which starts the page (`entries/shu-app.ts`). A gzipped payload is
 * in base64, which keeps a shared file small and doesn't need `</` escaped; its caller gzips it off the event loop. A plain
 * payload is JSON with `</` escaped, so a reader audits its redacted text in the file, as the check of obscured secrets does.
 */
export function buildReportHtml(basePath: string, payload: { gzipped: string } | { plain: string }): string {
	const inject = `const h = document.createElement("script"); h.type = "${MEDIA_TYPE.json}"; h.id = "${HYDRATION_ID}"; h.textContent = hydration; document.body.appendChild(h);
    for (const s of scripts) { const el = document.createElement("script"); el.textContent = s; document.body.appendChild(el); }
    const b = document.createElement("script"); b.textContent = bundle; document.body.appendChild(b);`;
	const loader =
		"gzipped" in payload
			? `  <script type="${MEDIA_TYPE.bytes}" id="shu-payload">${payload.gzipped}</script>
  <script>
  (async () => {
    const raw = Uint8Array.from(atob(document.getElementById("shu-payload").textContent), (c) => c.charCodeAt(0));
    const { bundle, hydration, scripts } = JSON.parse(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip"))).text());
    ${inject}
  })();
  </script>`
			: `  <script type="${MEDIA_TYPE.json}" id="shu-payload">${payload.plain.replaceAll("</", "<\\/")}</script>
  <script>
  (() => {
    const { bundle, hydration, scripts } = JSON.parse(document.getElementById("shu-payload").textContent);
    ${inject}
  })();
  </script>`;
	return spaDocument(basePath, loader);
}

/**
 * The component scripts a report inlines: each domain's `ui.jsContent`, for the components of the views the report shows.
 * A component's bundle is carried only where its view is shown.
 */
export function inlineScriptsForView(domains: Record<string, unknown>, finalViewComponents: Set<string>): string[] {
	return Object.values(domains)
		.map((d) => (d as { ui?: { component?: string; jsContent?: string } } | undefined)?.ui)
		.filter(
			(u): u is { component: string; jsContent: string } =>
				typeof u?.jsContent === "string" && u.jsContent.length > 0 && typeof u.component === "string" && finalViewComponents.has(u.component),
		)
		.map((u) => u.jsContent);
}
