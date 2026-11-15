/**
 * How the page imports the script of a view a concern declares. A concern names `ui.js` as a path relative to the page's
 * own bundle, but the loaders that run the import are split into chunks below the page's folder, so a bare name reaches the
 * chunk's folder rather than the page's. The page's entry records its own bundle URL here, so a bare name is resolved beside
 * the page bundle, under whatever prefix serves the page.
 */

/** The page's own bundle URL, set by the page's entry before it loads a view. */
let pageBundleUrl: string | undefined;

/** Records the page bundle's URL, so a bare view name resolves beside it. */
export function setPageBundleUrl(url: string): void {
	pageBundleUrl = url;
}

/** The address the page imports a view's script `ref` from. A ref the concern already addresses — a path below the page's
 *  folder (`./`), an absolute path (`/`), or a URL with a scheme — is imported as it stands. A bare name (no scheme, no path
 *  prefix) and a path leading up (`../`) name a bundle beside or above-beside the page's own bundle, so they resolve against
 *  the page bundle's folder, under whatever prefix serves the page. Where the entry hasn't recorded its URL, such a ref is
 *  returned as it stands. */
export function resolveViewScript(ref: string): string {
	if (/^[a-z][a-z\d+\-.]*:/i.test(ref) || ref.startsWith("/") || ref.startsWith("./")) return ref;
	// A report inlines the whole bundle as an iife, where the entry can't record a bundle URL, so such a ref is left to
	// resolve as the report addresses it; only the page's esm bundle records one.
	return pageBundleUrl ? new URL(ref, pageBundleUrl).href : ref;
}

/** The address of an asset the page serves beside its own bundle, such as the label font. `ref` is a path relative to the page
 *  bundle (e.g. `../shu-label-font.woff`), so it carries whatever prefix serves the page, as `resolveViewScript` does. Throws
 *  where the entry hasn't recorded the bundle URL: such a page carries its assets rather than reading them from a server. */
export function resolvePageAsset(ref: string): string {
	if (pageBundleUrl === undefined) throw new Error("the page records its own bundle URL before it reads an asset beside it");
	return new URL(ref, pageBundleUrl).href;
}
