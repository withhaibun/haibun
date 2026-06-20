import { html, type TemplateResult } from "lit";

/**
 * The one loading-vs-empty pathway every data control uses for an empty region. While the backing data is still being
 * retrieved (`loaded` is false) it shows a retrieving indicator — NEVER a false "no data". Once loaded, it shows the
 * empty message. So no control ever claims there is no data before its data has actually been fetched.
 *
 * Each control supplies its own `loaded` (e.g. `EventsController.loaded`, the clustered base's snapshot-loaded, or a
 * per-view fetch flag); the render is shared so the distinction is made identically everywhere. Relies on the consuming
 * view's `.empty` style and the globally-registered `<shu-spinner>`.
 */
export function emptyOrLoading(loaded: boolean, emptyMessage: string): TemplateResult {
	return loaded ? html`<div class="empty">${emptyMessage}</div>` : html`<div class="empty"><shu-spinner></shu-spinner> Loading…</div>`;
}
