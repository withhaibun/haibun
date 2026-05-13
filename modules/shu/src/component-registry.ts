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
	const { ShuActionsBar } = await import("./components/shu-actions-bar.js");
	const { ShuBreadcrumb } = await import("./components/shu-breadcrumb.js");
	const { ShuCombobox } = await import("./components/shu-combobox.js");
	const { ShuSpinner } = await import("./components/shu-spinner.js");
	const { StepCaller } = await import("./components/shu-step-caller.js");
	const { ShuSequenceDiagram } = await import("./components/shu-sequence-diagram.js");
	const { ShuMonitorColumn } = await import("./components/shu-monitor-column.js");
	const { ShuThreadColumn } = await import("./components/shu-thread-column.js");
	const { ShuGraphView } = await import("./components/shu-graph-view.js");
	const { ShuStepDetail } = await import("./components/shu-step-detail.js");
	const { ShuTimeline } = await import("./components/shu-timeline.js");
	const { ShuDocumentColumn } = await import("./components/shu-document-column.js");
	const { ShuProductView } = await import("./components/shu-product-view.js");
	const { ShuViewsPicker } = await import("./components/shu-views-picker.js");
	const { ShuAffordancesPanel } = await import("./components/shu-affordances-panel.js");
	const { ShuDomainChainView } = await import("./components/shu-domain-chain-view.js");
	const { ShuGraph } = await import("./components/shu-graph.js");
	const { ShuCopyButton } = await import("./components/shu-copy-button.js");
	const { ShuRef } = await import("./components/shu-ref.js");
	// Self-registering renderers
	await import("./query-uri.js");

	const components: [string, typeof HTMLElement][] = [
		["shu-graph-query", ShuGraphQuery],
		["shu-result-table", ShuResultTable],
		["shu-column-pane", ShuColumnPane],
		["shu-column-strip", ShuColumnStrip],
		["shu-entity-column", ShuEntityColumn],
		["shu-filter-column", ShuFilterColumn],
		["shu-actions-bar", ShuActionsBar],
		["shu-breadcrumb", ShuBreadcrumb],
		["shu-combobox", ShuCombobox],
		["shu-spinner", ShuSpinner],
		["shu-step-caller", StepCaller],
		["shu-sequence-diagram", ShuSequenceDiagram],
		["shu-monitor-column", ShuMonitorColumn],
		["shu-thread-column", ShuThreadColumn],
		["shu-graph-view", ShuGraphView],
		["shu-step-detail", ShuStepDetail],
		["shu-timeline", ShuTimeline],
		["shu-document-column", ShuDocumentColumn],
		["shu-product-view", ShuProductView],
		["shu-views-picker", ShuViewsPicker],
		["shu-affordances-panel", ShuAffordancesPanel],
		["shu-domain-chain-view", ShuDomainChainView],
		["shu-graph", ShuGraph],
		["shu-copy-button", ShuCopyButton],
		["shu-ref", ShuRef],
	];

	for (const [tag, component] of components) {
		if (!customElements.get(tag)) {
			customElements.define(tag, component);
		}
	}
};
