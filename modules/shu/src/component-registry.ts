/**
 * Register all graph-based web components.
 * Must only be called in browser context.
 */
export const registerComponents = async (): Promise<void> => {
	const { ShuGraphQuery } = await import("./components/shu-graph-query.js");
	const { ShuResultTable } = await import("./components/shu-result-table.js");
	const { ShuColumnPane } = await import("./components/shu-column-pane.js");
	const { ShuColumnStrip } = await import("./components/shu-column-strip.js");
	const { ShuEntityColumn } = await import("./components/shu-entity-column.js");
	const { ShuFilterColumn } = await import("./components/shu-filter-column.js");
	const { ShuColumnBrowser } = await import("./components/shu-column-browser.js");
	const { ShuActionsBar } = await import("./components/shu-actions-bar.js");
	const { ShuBreadcrumb } = await import("./components/shu-breadcrumb.js");
	const { ShuCombobox } = await import("./components/shu-combobox.js");
	const { ShuSpinner } = await import("./components/shu-spinner.js");
	const { StepCaller } = await import("./components/shu-step-caller.js");
	const { ShuSequenceDiagram } = await import("./components/shu-sequence-diagram.js");
	const { ShuMonitorColumn } = await import("./components/shu-monitor-column.js");
	const { ShuThreadColumn } = await import("./components/shu-thread-column.js");
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
		["shu-step-caller", StepCaller],
		["shu-sequence-diagram", ShuSequenceDiagram],
		["shu-monitor-column", ShuMonitorColumn],
		["shu-thread-column", ShuThreadColumn],
	];

	for (const [tag, component] of components) {
		if (!customElements.get(tag)) {
			customElements.define(tag, component);
		}
	}
};
