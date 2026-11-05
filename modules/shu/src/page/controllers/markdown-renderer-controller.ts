/**
 * The markdown renderer and the HTML sanitizer a view renders text with, loaded at the first text the view renders as
 * markdown: a record's body, or a message in the transcript. The view shows the text as it reads until the renderer
 * loads, and renders again once it has.
 */
import type { ReactiveControllerHost } from "lit";
import { loadedOnFirstUse } from "../root.js";
import type * as MarkdownRender from "../derivations/markdown-render.js";

const loading = loadedOnFirstUse(() => import("../derivations/markdown-render.js"));

export class MarkdownRendererController {
	readonly #host: ReactiveControllerHost;
	#loaded: typeof MarkdownRender | undefined = undefined;

	constructor(host: ReactiveControllerHost) {
		this.#host = host;
	}

	/** The renderer, or undefined while it loads. Reading it starts the load, after which the host renders again. */
	get renderer(): typeof MarkdownRender | undefined {
		if (this.#loaded === undefined)
			void loading().then((loaded) => {
				this.#loaded = loaded;
				this.#host.requestUpdate();
			});
		return this.#loaded;
	}
}
