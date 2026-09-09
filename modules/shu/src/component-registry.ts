import { SHU_TAG } from "./consts.js";
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
	const { ShuIndexSummary } = await import("./components/shu-index-summary.js");
	const { ShuPlayback } = await import("./components/shu-playback.js");
	const { ShuDocumentColumn } = await import("./components/shu-document-column.js");
	const { ShuClientCacheColumn } = await import("./components/shu-client-cache-column.js");
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
		[SHU_TAG.PERMISSIONS, ShuPermissions],
		[SHU_TAG.GRAPH_QUERY, ShuGraphQuery],
		[SHU_TAG.RESULT_TABLE, ShuResultTable],
		[SHU_TAG.COLUMN_PANE, ShuColumnPane],
		[SHU_TAG.COLUMN_STRIP, ShuColumnStrip],
		[SHU_TAG.ENTITY_COLUMN, ShuEntityColumn],
		[SHU_TAG.FILTER_COLUMN, ShuFilterColumn],
		[SHU_TAG.ACTIONS_BAR, ShuActionsBar],
		[SHU_TAG.KIHAN_CHAT, ShuKihanChat],
		[SHU_TAG.BREADCRUMB, ShuBreadcrumb],
		[SHU_TAG.COMBOBOX, ShuCombobox],
		[SHU_TAG.SPINNER, ShuSpinner],
		[SHU_TAG.STEP_CALLER, StepCaller],
		[SHU_TAG.MONITOR_COLUMN, ShuMonitorColumn],
		[SHU_TAG.THREAD_COLUMN, ShuThreadColumn],
		[SHU_TAG.STEP_DETAIL, ShuStepDetail],
		[SHU_TAG.INDEX_SUMMARY, ShuIndexSummary],
		[SHU_TAG.PLAYBACK, ShuPlayback],
		[SHU_TAG.DOCUMENT_COLUMN, ShuDocumentColumn],
		[SHU_TAG.CLIENT_CACHE_COLUMN, ShuClientCacheColumn],
		[SHU_TAG.PRODUCT_VIEW, ShuProductView],
		[SHU_TAG.VIEWS_PICKER, ShuViewsPicker],
		[SHU_TAG.AFFORDANCES_PANEL, ShuAffordancesPanel],
		[SHU_TAG.DOMAIN_CHAIN_VIEW, ShuDomainChainView],
		[SHU_TAG.GRAPH, ShuGraph],
		[SHU_TAG.COPY_BUTTON, ShuCopyButton],
		[SHU_TAG.REF, ShuRef],
		[SHU_TAG.TYPE_COLUMN, ShuTypeColumn],
		[SHU_TAG.THEME_SWITCH, ShuThemeSwitch],
	];

	for (const [tag, component] of components) {
		if (!customElements.get(tag)) {
			customElements.define(tag, component);
		}
	}
};
