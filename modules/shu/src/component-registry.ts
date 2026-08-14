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
	const { ShuKihanChat } = await import("./components/shu-kihan-chat.js");
	const { ShuBreadcrumb } = await import("./components/shu-breadcrumb.js");
	const { ShuCombobox } = await import("./components/shu-combobox.js");
	const { ShuSpinner } = await import("./components/shu-spinner.js");
	const { StepCaller } = await import("./components/shu-step-caller.js");
	const { ShuMonitorColumn } = await import("./components/shu-monitor-column.js");
	const { ShuThreadColumn } = await import("./components/shu-thread-column.js");
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
	const { ShuTypeColumn } = await import("./components/shu-type-column.js");
	const { ShuThemeSwitch } = await import("./components/shu-theme-switch.js");
	const { ShuPermissions } = await import("./components/shu-permissions.js");

	const components: [string, typeof HTMLElement][] = [
		["shu-permissions", ShuPermissions],
		["shu-graph-query", ShuGraphQuery],
		["shu-result-table", ShuResultTable],
		["shu-column-pane", ShuColumnPane],
		["shu-column-strip", ShuColumnStrip],
		["shu-entity-column", ShuEntityColumn],
		["shu-filter-column", ShuFilterColumn],
		["shu-actions-bar", ShuActionsBar],
		["shu-kihan-chat", ShuKihanChat],
		["shu-breadcrumb", ShuBreadcrumb],
		["shu-combobox", ShuCombobox],
		["shu-spinner", ShuSpinner],
		["shu-step-caller", StepCaller],
		["shu-monitor-column", ShuMonitorColumn],
		["shu-thread-column", ShuThreadColumn],
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
		["shu-type-column", ShuTypeColumn],
		["shu-theme-switch", ShuThemeSwitch],
	];

	for (const [tag, component] of components) {
		if (!customElements.get(tag)) {
			customElements.define(tag, component);
		}
	}
};
