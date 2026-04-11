import { SHARED_STYLES } from "./styles.js";
import { SseClient } from "../sse-client.js";
import { getAvailableSteps, findStep, type StepDescriptor } from "../rpc-registry.js";
import { VIEW_EVENTS } from "../consts.js";
import { renderValue } from "./value-renderers.js";
import { esc, escAttr } from "../util.js";

type InputProperty = {
	type?: string;
	description?: string;
	enum?: string[];
	[key: string]: unknown;
};

/**
 * Generic step caller component. Renders input form from inputSchema,
 * calls the step via RPC, and renders output from outputSchema.
 *
 * Attributes:
 *   step     — step name (looked up via findStep)
 *   auto     — call on mount without showing input form
 *   params   — JSON string of fixed params, merged with form values
 */
export class StepCaller extends HTMLElement {
	private descriptor: StepDescriptor | undefined;
	private fixedParams: Record<string, unknown> = {};
	private result: unknown = null;
	private error = "";
	private loading = false;
	private _executed = false;
	get executed(): boolean {
		return this._executed;
	}
	private lastFormValues: Record<string, string> = {};

	connectedCallback(): void {
		if (!this.shadowRoot) this.attachShadow({ mode: "open" });
		if (this.descriptor) return; // Already initialized — just re-attached
		void this.init();
	}

	/** Reset and re-initialize with a new step (e.g. when user picks a different step). */
	reset(stepName: string): void {
		this.setAttribute("step", stepName);
		this.descriptor = undefined;
		this._executed = false;
		this.result = null;
		this.error = "";
		this.lastFormValues = {};
		void this.init();
	}

	async init(): Promise<void> {
		this.result = null;
		this.error = "";
		this.loading = false;
		this._executed = false;
		this.lastFormValues = {};
		await getAvailableSteps();
		const stepName = this.getAttribute("step") || "";
		this.descriptor = findStep(stepName);
		if (!this.descriptor) {
			this.error = `Step "${stepName}" not found`;
			this.renderComponent();
			return;
		}

		const paramsAttr = this.getAttribute("params");
		if (paramsAttr) {
			try {
				this.fixedParams = JSON.parse(paramsAttr);
			} catch {
				this.error = "Invalid params JSON";
			}
		}

		if (this.hasAttribute("auto")) {
			await this.callStep();
		} else {
			this.renderComponent();
		}
	}

	private async callStep(formValues: Record<string, string> = {}): Promise<void> {
		if (!this.descriptor) return;
		// Retire current-* testids on all sibling step callers so waitFor finds only this result
		for (const sibling of Array.from(this.parentElement?.querySelectorAll("shu-step-caller") ?? [])) {
			if (sibling !== this) (sibling as StepCaller).retireCurrentTestIds();
		}
		this.lastFormValues = { ...formValues };
		this.loading = true;
		this.error = "";
		this.result = null;
		this.renderComponent();

		const params: Record<string, unknown> = { ...this.fixedParams };
		const schema = this.descriptor.inputSchema as { properties?: Record<string, { type?: string }> } | undefined;
		for (const [key, value] of Object.entries(formValues)) {
			const propType = schema?.properties?.[key]?.type;
			if ((propType === "object" || propType === "array") && value) {
				params[key] = JSON.parse(value);
			} else if (propType === "number" && value) {
				params[key] = Number(value);
			} else {
				params[key] = value;
			}
		}
		const client = SseClient.for("");

		try {
			this.result = await client.rpc(this.descriptor.method, params);
			// If products contain a view, open the corresponding column
			const view = (this.result as Record<string, unknown>)?.view;
			if (typeof view === "string" && VIEW_EVENTS[view]) {
				this.dispatchEvent(new CustomEvent(VIEW_EVENTS[view], { bubbles: true, composed: true }));
			}
			this.dispatchEvent(
				new CustomEvent("step-success", {
					bubbles: true,
					composed: true,
					detail: this.result,
				}),
			);
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
			this.dispatchEvent(
				new CustomEvent("step-error", {
					bubbles: true,
					composed: true,
					detail: this.error,
				}),
			);
		}
		this.loading = false;
		this._executed = true;
		this.renderComponent();
		this.dataset.testid = this.error ? "current-step-error" : "current-step-result";
		this.scrollIntoView({ behavior: "smooth", block: "nearest" });
	}

	retireCurrentTestIds(): void {
		const stepName = this.getAttribute("step") || "";
		if (this.dataset.testid?.startsWith("current-")) {
			this.dataset.testid = this.dataset.testid.replace("current-", `${stepName}-`);
		}
		this.shadowRoot?.querySelectorAll('[data-testid^="current-"]').forEach((el) => {
			const id = (el as HTMLElement).dataset.testid;
			if (!id) return;
			(el as HTMLElement).dataset.testid = id.replace("current-", `${stepName}-`);
		});
	}

	private renderComponent(): void {
		if (!this.shadowRoot) return;
		const desc = this.descriptor;
		const stepName = this.getAttribute("step") || "";

		const dismissBtn = this.executed ? '<button class="dismiss-btn" title="Remove">x</button>' : "";

		this.shadowRoot.innerHTML = `
			${this.css()}
			<div class="step-caller" data-testid="step-caller-${esc(stepName)}">
				${dismissBtn}
				${desc && !this.hasAttribute("auto") ? this.renderForm(desc) : ""}
				${this.loading ? `<div class="loading" data-testid="current-step-loading">loading...</div>` : ""}
				${this.result !== null ? `<div data-testid="current-step-result">${this.renderOutput()}</div>` : ""}
				${this.error ? `<div class="error" data-testid="current-step-error">${esc(this.error)}</div>` : ""}
				${!this.error && this.result !== null && !desc?.outputSchema ? '<div class="success" data-testid="current-step-success">done</div>' : ""}
			</div>
		`;
		this.bindEvents();
	}

	private renderForm(desc: StepDescriptor): string {
		const schema = desc.inputSchema as { properties?: Record<string, InputProperty>; required?: string[] } | undefined;
		const properties = schema?.properties || {};
		const currentStepName = this.getAttribute("step") || "";
		const tid = (suffix: string) => {
			const named = `${escAttr(currentStepName)}-${escAttr(suffix)}`;
			return this.executed ? ` data-testid="${named}"` : ` data-testid="current-${escAttr(suffix)}" data-step-testid="${named}"`;
		};

		// Parse the gwta pattern into text segments and inline inputs
		const pattern = desc.pattern || "";
		const parts: string[] = [];
		let last = 0;
		const paramRegex = /\{(\w+)(?::\s*[^}]*)?\}/g;
		let match: RegExpExecArray | null;

		while ((match = paramRegex.exec(pattern)) !== null) {
			if (match.index > last) {
				parts.push(`<span class="step-text">${esc(pattern.slice(last, match.index))}</span>`);
			}
			const paramName = match[1];
			if (paramName in this.fixedParams) {
				parts.push(`<span class="step-fixed">${esc(String(this.fixedParams[paramName]))}</span>`);
			} else {
				const prop = properties[paramName];
				if (prop?.enum) {
					const savedVal = this.lastFormValues[paramName] || "";
					const options = prop.enum.map((v: string) => `<option value="${escAttr(v)}"${v === savedVal ? " selected" : ""}>${esc(v)}</option>`).join("");
					parts.push(
						`<select name="${escAttr(paramName)}" class="inline-select"${tid(`step-select-${paramName}`)}><option value=""${!savedVal ? " selected" : ""}>${esc(paramName)}</option>${options}</select>`,
					);
				} else {
					const saved = this.lastFormValues[paramName] || "";
					const sz = Math.max(saved.length, paramName.length, 4);
					parts.push(
						`<input type="text" name="${escAttr(paramName)}" class="inline-input" placeholder="${escAttr(paramName)}" value="${escAttr(saved)}" size="${sz}"${tid(`step-input-${paramName}`)} />`,
					);
				}
			}
			last = match.index + match[0].length;
		}
		if (last < pattern.length) {
			parts.push(`<span class="step-text">${esc(pattern.slice(last))}</span>`);
		}

		const runLabel = this.executed ? "\u27F3\u25B6" : "\u25B6";
		return `<form class="step-form step-sentence">${parts.join(" ")} <button type="submit" class="run-inline${this.executed ? " rerun" : ""}" title="${this.executed ? "Re-run" : "Run"}"${tid("step-run")}>${runLabel}</button></form>`;
	}

	private renderOutput(): string {
		const data = this.result as Record<string, unknown>;
		const schema = this.descriptor?.outputSchema as Record<string, unknown> | undefined;
		if (!schema) {
			return data != null ? `<pre>${esc(JSON.stringify(data, null, 2))}</pre>` : "";
		}
		return this.renderBySchema(data, schema);
	}

	private renderBySchema(data: unknown, schema: Record<string, unknown>): string {
		if (!data) return "";
		const jsonSchema = schema as {
			type?: string;
			properties?: Record<string, Record<string, unknown>>;
			items?: Record<string, unknown>;
		};

		// If schema wraps a single property (e.g. { properties: { types: ... } }), unwrap
		if (jsonSchema.type === "object" && jsonSchema.properties) {
			const keys = Object.keys(jsonSchema.properties);
			if (keys.length === 1) {
				const key = keys[0];
				const inner = (data as Record<string, unknown>)[key];
				if (inner !== undefined) {
					return this.renderBySchema(inner, jsonSchema.properties[key]);
				}
			}
			return this.renderDl(data as Record<string, unknown>);
		}

		if (jsonSchema.type === "array" && Array.isArray(data)) {
			const items = jsonSchema.items;
			if (items && typeof items === "object" && (items as Record<string, unknown>).type === "object") {
				return this.renderTable(data as Record<string, unknown>[]);
			}
			return `<ul>${(data as unknown[]).map((v) => `<li>${this.renderCell(v)}</li>`).join("")}</ul>`;
		}

		if (typeof data === "string" || typeof data === "number") {
			return `<span>${esc(String(data))}</span>`;
		}

		return `<pre>${esc(JSON.stringify(data, null, 2))}</pre>`;
	}

	private renderTable(rows: Record<string, unknown>[]): string {
		if (rows.length === 0) return "<p>No results.</p>";
		const cols = Object.keys(rows[0]);
		const header = cols.map((c) => `<th>${esc(c)}</th>`).join("");
		const body = rows.map((r) => `<tr>${cols.map((c) => `<td>${this.renderCell(r[c])}</td>`).join("")}</tr>`).join("");
		return `<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
	}

	private renderDl(obj: Record<string, unknown>): string {
		const entries = Object.entries(obj)
			.map(([k, v]) => `<dt>${esc(k)}</dt><dd data-testid="step-result-${escAttr(k)}">${this.renderCell(v)}</dd>`)
			.join("");
		return `<dl>${entries}</dl>`;
	}

	private renderCell(value: unknown): string {
		const s = typeof value === "string" ? value : JSON.stringify(value);
		const custom = renderValue(s);
		if (custom !== null) return custom;
		return esc(s);
	}

	private bindEvents(): void {
		this.shadowRoot?.querySelector(".dismiss-btn")?.addEventListener("click", () => {
			this.remove();
		});

		const form = this.shadowRoot?.querySelector(".step-form");
		if (form) {
			form.addEventListener("submit", (e) => {
				e.preventDefault();
				const inputs = Array.from((form as HTMLFormElement).querySelectorAll<HTMLInputElement | HTMLSelectElement>("input[name], select[name]"));
				const values: Record<string, string> = {};
				for (const input of inputs) {
					if (input.value) values[input.name] = input.value;
				}
				void this.callStep(values);
			});

			// Auto-expand inline inputs as user types
			form.querySelectorAll<HTMLInputElement>(".inline-input").forEach((input) => {
				const resize = () => {
					const len = Math.max(input.value.length, input.placeholder.length, 4);
					input.size = len + 1;
				};
				input.addEventListener("input", resize);
			});
		}
	}

	private css(): string {
		return `<style>
			${SHARED_STYLES}
			table { width: 100%; border-collapse: collapse; font-size: 13px; }
			th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid #eee; }
			th { font-weight: normal; color: #666; border-bottom: 2px solid #000; }
			td { font-family: monospace; }
			.loading { color: #666; font-style: italic; }
			dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; }
			dt { font-weight: bold; }
			pre { white-space: pre-wrap; font-size: 12px; }
			ul { list-style: none; padding: 0; }
			ul li { padding: 2px 0; border-bottom: 1px solid #eee; }
			:host { display: block; }
			.step-sentence {
				display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 6px;
				font: inherit; line-height: 1.8; padding: 2px 0;
			}
			.step-text { color: #888; white-space: nowrap; }
			.step-fixed { color: #333; font-weight: 500; white-space: nowrap; }
			.inline-input {
				font: inherit; padding: 2px 4px; margin: 1px 0;
				border: 1px solid #ddd; border-radius: 3px;
				background: #f8f8f8; color: #222; outline: none;
				width: auto;
			}
			.inline-input:focus { border-color: #888; background: #fff; }
			.inline-input::placeholder { color: #bbb; }
			.inline-select {
				font: inherit; padding: 2px 4px; margin: 1px 0;
				border: 1px solid #ddd; border-radius: 3px;
				background: #f8f8f8; color: #222; outline: none;
				width: auto;
			}
			.inline-select:focus { border-color: #888; background: #fff; }
			.run-inline {
				padding: 2px 8px; background: #1a6b3c; color: #fff; border: 1px solid #1a6b3c;
				border-radius: 3px; font: inherit; cursor: pointer; margin-left: 2px; font-size: 12px;
			}
			.run-inline:hover { background: #145530; }
			.run-inline.rerun { background: #2a7b4c; }
			.dismiss-btn {
				float: right; background: none; border: none; color: #999; cursor: pointer;
				font-size: 12px; padding: 0 4px; line-height: 1; width: auto;
			}
			.dismiss-btn:hover { color: #c00; }
		</style>`;
	}
}
