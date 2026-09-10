import { html, type TemplateResult } from "lit";

/**
 * The one waiting-versus-empty pathway every data control uses for an empty region. While the data is still being read
 * (`loaded` is false) it reports that it is waiting, NEVER a false "no data". Once read, it shows the empty message. So
 * no control states that there is no data before its data has been read.
 *
 * Each control supplies its own `loaded` (e.g. a run source's `loaded`, the clustered base's snapshot-loaded, or a
 * per-view fetch flag); the render is shared so the distinction is made identically everywhere. Relies on the consuming
 * view's `.empty` style and the globally-registered `<shu-spinner>`.
 */
export function emptyOrLoading(loaded: boolean, emptyMessage: string): TemplateResult {
	return loaded ? html`<div class="empty">${emptyMessage}</div>` : html`<div class="empty"><shu-spinner></shu-spinner> Waiting…</div>`;
}

/** The same pathway for data that may be UNAVAILABLE: not cached on this device and no server answered. That is a third
 *  state, distinct from loading and from empty, and the reader is told which it is rather than shown a false "no data". */
export function unavailableOrEmpty(loaded: boolean, unavailable: string | null, emptyMessage: string): TemplateResult {
	return unavailable ? html`<div class="empty unavailable">${unavailable}</div>` : emptyOrLoading(loaded, emptyMessage);
}
