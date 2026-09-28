/**
 * Define the app's elements. Each module defines its own element when it is imported, so boot imports them once it has
 * set up what they read when they connect. Must only be called in browser context.
 */
export const registerComponents = async (): Promise<void> => {
	await import("./components/shu-permissions.js");
	await import("./components/shu-page-key.js");
	await import("./components/shu-graph-query.js");
	await import("./components/shu-result-table.js");
	await import("./components/shu-column-pane.js");
	await import("./components/shu-column-strip.js");
	await import("./components/shu-entity-column.js");
	await import("./components/shu-filter-column.js");
	await import("./components/shu-actions-bar.js");
	await import("./components/shu-page-strip.js");
	await import("./components/shu-kihan-chat.js");
	await import("./components/shu-breadcrumb.js");
	await import("./components/shu-combobox.js");
	await import("./components/shu-spinner.js");
	await import("./components/shu-step-caller.js");
	await import("./components/shu-monitor-column.js");
	await import("./components/shu-thread-column.js");
	await import("./components/shu-step-detail.js");
	await import("./components/shu-index-summary.js");
	await import("./components/shu-playback.js");
	await import("./components/shu-document-column.js");
	await import("./components/shu-client-cache-column.js");
	await import("./components/shu-product-view.js");
	await import("./components/shu-views-picker.js");
	await import("./components/shu-affordances-panel.js");
	await import("./components/shu-domain-chain-view.js");
	await import("./components/shu-graph.js");
	await import("./components/shu-copy-button.js");
	await import("./components/shu-ref-element.js");
	await import("./components/shu-type-column.js");
	await import("./components/shu-step-definition.js");
	await import("./components/shu-action-column.js");
	await import("./components/shu-theme-switch.js");
};
