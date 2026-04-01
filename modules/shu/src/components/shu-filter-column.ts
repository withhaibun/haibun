import { defaultLabel } from "../util.js";
/**
 * <shu-filter-column> — Query results column.
 * Creates result table ONCE on connect. Updates data without replacing DOM.
 * No innerHTML rewrites — stable DOM, no stale references.
 */
import { ShuElement } from "./shu-element.js";
import { FilterColumnSchema } from "../schemas.js";
import { errMsg } from "../util.js";
import { SseClient } from "../sse-client.js";
import { getAvailableSteps, requireStep } from "../rpc-registry.js";
import type { ShuResultTable } from "./shu-result-table.js";
import type { ShuSpinner } from "./shu-spinner.js";

type VertexData = Record<string, unknown>;

export class ShuFilterColumn extends ShuElement<typeof FilterColumnSchema> {
	private results: VertexData[] = [];
	private resultTable: ShuResultTable | null = null;
	private spinner: ShuSpinner | null = null;
	private errorEl: HTMLElement | null = null;

	constructor() {
		super(FilterColumnSchema, { loading: true });
	}

	async openFiltered(
		property: string,
		value: string,
		label: string = defaultLabel(),
	): Promise<void> {
		this.state = {
			...this.state,
			property,
			value,
			vertexLabel: label,
			loading: true,
			error: undefined,
		};
		this.showSpinner("Fetching...");
		await this.fetchResults({
			label,
			filters: [{ property, operator: "eq", value }],
			sortBy: "",
			sortOrder: "desc",
			limit: 50,
			offset: 0,
			accessLevel: "private",
		});
	}

	async openProperty(
		property: string,
		label: string = defaultLabel(),
	): Promise<void> {
		this.state = {
			...this.state,
			property,
			vertexLabel: label,
			loading: true,
			error: undefined,
		};
		this.showSpinner("Fetching...");
		await this.fetchResults({
			label,
			filters: [],
			sortBy: property,
			sortOrder: "asc",
			limit: 50,
			offset: 0,
			accessLevel: "private",
		});
	}

	async openIncoming(targetId: string, targetLabel: string): Promise<void> {
		this.state = {
			...this.state,
			vertexLabel: targetLabel,
			property: "linksTo",
			value: targetId,
			loading: true,
			error: undefined,
		};
		this.showSpinner("Fetching...");
		await this.fetchIncoming(targetLabel, targetId, 50, 0);
	}

	private async fetchIncoming(
		label: string,
		id: string,
		limit: number,
		offset: number,
	): Promise<void> {
		try {
			await getAvailableSteps();
			const client = SseClient.for("");
			const data = await client.rpc<{
				edges: Array<{ type: string; target: VertexData }>;
				total: number;
			}>(requireStep("getIncomingEdges"), { label, id, limit, offset });
			this.results = data.edges.map((e) => e.target);
			this.state = { ...this.state, loading: false };
			this.showResults();
			if (this.resultTable)
				this.resultTable.setPagination(data.total, limit, offset);
		} catch (err) {
			console.error("[filter-column] incoming fetch failed:", err);
			this.state = { ...this.state, loading: false, error: errMsg(err) };
			this.showError(errMsg(err));
		}
	}

	private async fetchResults(query: Record<string, unknown>): Promise<void> {
		try {
			await getAvailableSteps();
			const client = SseClient.for("");
			const data = await client.rpc<{ vertices: VertexData[]; total: number }>(
				requireStep("graphQuery"),
				{ query },
			);
			this.results = data.vertices ?? [];
			this.state = { ...this.state, loading: false };
			this.showResults();
		} catch (err) {
			console.error("[filter-column] fetch failed:", err);
			this.state = { ...this.state, loading: false, error: errMsg(err) };
			this.showError(errMsg(err));
		}
	}

	/** Build the stable DOM structure once. */
	protected render(): void {
		if (!this.shadowRoot) return;

		// Create elements once — never replace via innerHTML after this
		const style = document.createElement("style");
		style.textContent = STYLES;
		this.shadowRoot.appendChild(style);

		this.spinner = document.createElement("shu-spinner") as ShuSpinner;
		this.spinner.status = "Waiting...";
		this.spinner.visible = true;
		this.shadowRoot.appendChild(this.spinner);

		this.errorEl = document.createElement("div");
		this.errorEl.className = "error-banner";
		this.errorEl.style.display = "none";
		this.shadowRoot.appendChild(this.errorEl);

		const table = document.createElement("shu-result-table") as ShuResultTable;
		table.style.display = "none";
		table.style.flex = "1";
		this.shadowRoot.appendChild(table);
		this.resultTable = table;

		// Forward events
		table.addEventListener("row-click", ((e: CustomEvent) => {
			const { vertexId: vid, label: rowLabel } = e.detail;
			if (vid) {
				this.dispatchEvent(
					new CustomEvent("column-open", {
						detail: {
							subject: vid,
							label: rowLabel || this.state.vertexLabel || defaultLabel(),
						},
						bubbles: true,
						composed: true,
					}),
				);
			}
		}) as EventListener);

		table.addEventListener("sort-change", ((e: CustomEvent) => {
			const { field, order } = e.detail;
			table.updateState({ sortBy: field, sortOrder: order });
		}) as EventListener);

		table.addEventListener("page-change", ((e: CustomEvent) => {
			const { offset } = e.detail;
			if (this.state.property === "linksTo" && this.state.value) {
				void this.fetchIncoming(
					this.state.vertexLabel || defaultLabel(),
					this.state.value,
					50,
					offset,
				);
			}
		}) as EventListener);
	}

	private showSpinner(msg: string): void {
		if (this.spinner) {
			this.spinner.status = msg;
			this.spinner.visible = true;
		}
		if (this.errorEl) this.errorEl.style.display = "none";
		if (this.resultTable) this.resultTable.style.display = "none";
	}

	private showError(msg: string): void {
		if (this.spinner) this.spinner.visible = false;
		if (this.errorEl) {
			this.errorEl.textContent = msg;
			this.errorEl.style.display = "";
		}
		if (this.resultTable) this.resultTable.style.display = "none";
	}

	private showResults(): void {
		if (this.spinner) this.spinner.visible = false;
		if (this.errorEl) this.errorEl.style.display = "none";
		if (this.resultTable) {
			const { property } = this.state;
			// Filter queries return full vertices — show all properties, just hide the filtered one
			this.resultTable.updateState({
				displayMode: "full",
				fixedProperty: property,
			});
			this.resultTable.setResults(this.results);
			this.resultTable.setPagination(this.results.length, 50, 0);
			this.resultTable.style.display = "";
		}
	}
}

const STYLES = `
	:host { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
	.error-banner { padding: 6px 8px; margin: 4px; background: #fdd; border: 1px solid #c00; color: #900; border-radius: 3px; }
`;
