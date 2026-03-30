/**
 * Register all graph-based web components.
 * Must only be called in browser context.
 */
export const registerComponents = async (): Promise<void> => {
	const { ShuGraphQuery } = await import("./graph-query.js");
	const { ShuResultTable } = await import("./shu-result-table.js");
	const { ShuColumnPane } = await import("./shu-column-pane.js");
	const { ShuColumnStrip } = await import("./shu-column-strip.js");
	const { ShuEntityColumn } = await import("./shu-entity-column.js");
	const { ShuFilterColumn } = await import("./shu-filter-column.js");
	const { ShuColumnBrowser } = await import("./shu-column-browser.js");
	const { ShuActionsBar } = await import("./actions-bar.js");
	const { ShuBreadcrumb } = await import("./shu-breadcrumb.js");
	const { ShuCombobox } = await import("./shu-combobox.js");
	const { ShuSpinner } = await import("./shu-spinner.js");
	const { StepCaller } = await import("./step-caller.js");
	// Self-registering renderers
	await import("./query-uri.js");

	const components: [string, typeof HTMLElement][] = [
		["shu-graph-query", ShuGraphQuery],
		["shu-result-table", ShuResultTable],
		["shu-column-pane", ShuColumnPane],
		["shu-column-strip", ShuColumnStrip],
		["shu-entity-column", ShuEntityColumn],
		["shu-filter-column", ShuFilterColumn],
		["shu-column-browser", ShuColumnBrowser],
		["shu-actions-bar", ShuActionsBar],
		["shu-breadcrumb", ShuBreadcrumb],
		["shu-combobox", ShuCombobox],
		["shu-spinner", ShuSpinner],
		["step-caller", StepCaller],
	];

	for (const [tag, component] of components) {
		if (!customElements.get(tag)) {
			customElements.define(tag, component);
		}
	}
};
