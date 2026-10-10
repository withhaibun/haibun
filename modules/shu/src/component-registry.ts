/**
 * Define the app's elements. Each module defines its own element when it is imported, so boot imports them once it has
 * set up what they read when they connect. Must only be called in browser context.
 */
export const registerComponents = async (): Promise<void> => {
	await import("./page/components/shu-permissions.js");
	await import("./page/components/shu-page-key.js");
	await import("./page/components/shu-graph-query.js");
	await import("./page/components/shu-result-table.js");
	await import("./page/components/shu-column-pane.js");
	await import("./page/components/shu-column-strip.js");
	await import("./page/components/shu-entity-column.js");
	await import("./page/components/shu-filter-column.js");
	await import("./page/components/shu-actions-bar.js");
	await import("./page/components/shu-page-strip.js");
	await import("./page/components/shu-kihan-chat.js");
	await import("./page/components/shu-breadcrumb.js");
	await import("./page/components/shu-combobox.js");
	await import("./page/components/shu-spinner.js");
	await import("./page/components/shu-step-caller.js");
	await import("./page/components/shu-monitor-column.js");
	await import("./page/components/shu-thread-column.js");
	await import("./page/components/shu-step-detail.js");
	await import("./page/components/shu-index-summary.js");
	await import("./page/components/shu-playback.js");
	await import("./page/components/shu-document-column.js");
	await import("./page/components/shu-client-cache-column.js");
	await import("./page/components/shu-product-view.js");
	await import("./page/components/shu-views-picker.js");
	await import("./page/components/shu-affordances-panel.js");
	await import("./page/components/shu-domain-chain-view.js");
	await import("./components/shu-graph.js");
	await import("./page/components/shu-copy-button.js");
	await import("./page/components/shu-ref-element.js");
	await import("./page/components/shu-type-column.js");
	await import("./page/components/shu-step-definition.js");
	await import("./page/components/shu-action-column.js");
	await import("./page/components/shu-theme-switch.js");
};
