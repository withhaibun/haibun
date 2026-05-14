import { SHARED_STYLES } from "./styles.js";
import { SseClient, inAction } from "../sse-client.js";
import { getAvailableSteps, findStep, requireStep, type StepDescriptor } from "../rpc-registry.js";
import { dispatchAffordanceFromResponse } from "../affordance-dispatch.js";
import { renderValue } from "./value-renderers.js";
import { esc, escAttr, prettifyGwta } from "../util.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { validateStepInput, type TFieldError } from "../step-input-validator.js";
import { getConcernCatalog } from "../rels-cache.js";
import type { TComboboxOption } from "../schemas.js";

type InputProperty = {
	type?: string;
	description?: string;
	enum?: string[];
	properties?: Record<string, InputProperty>;
	required?: string[];
	[key: string]: unknown;
};

/**
 * Recognise a composite (z.object) input property — render one field per
 * sub-property instead of a single stringified-JSON text input. Without this,
 * typing into a composite input requires the user to hand-type valid JSON and
 * silently crashes on anything else.
 */
function isCompositeProperty(prop: InputProperty | undefined): prop is InputProperty & { properties: Record<string, InputProperty> } {
	return prop?.type === "object" && !!prop.properties && Object.keys(prop.properties).length > 0;
}

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
	private fieldErrors: Record<string, string> = {};
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
		this.lastFormValues = { ...formValues };
		this.loading = true;
		this.error = "";
		this.result = null;
		this.fieldErrors = {};
		this.renderComponent();

		const params: Record<string, unknown> = { ...this.fixedParams };
		const schema = this.descriptor.inputSchema as { properties?: Record<string, InputProperty> } | undefined;
		try {
			for (const [key, value] of Object.entries(formValues)) {
				const dotIndex = key.indexOf(".");
				if (dotIndex > 0) {
					const parent = key.slice(0, dotIndex);
					const sub = key.slice(dotIndex + 1);
					const subSchema = schema?.properties?.[parent]?.properties?.[sub];
					const propType = subSchema?.type;
					if (!value && !schema?.properties?.[parent]?.required?.includes(sub)) continue;
					const existing = (params[parent] as Record<string, unknown> | undefined) ?? {};
					if ((propType === "array" || propType === "object") && value) existing[sub] = JSON.parse(value);
					else if (propType === "number" && value) existing[sub] = Number(value);
					else existing[sub] = value;
					params[parent] = existing;
					continue;
				}
				const propType = schema?.properties?.[key]?.type;
				if ((propType === "object" || propType === "array") && value) {
					params[key] = JSON.parse(value);
				} else if (propType === "number" && value) {
					params[key] = Number(value);
				} else {
					params[key] = value;
				}
			}
		} catch (err) {
			this.error = `invalid input: ${errorDetail(err)}`;
			this.loading = false;
			this._executed = true;
			this.renderComponent();
			this.dataset.testid = `${this.idPrefix()}-step-error`;
			this.dispatchEvent(new CustomEvent("step-error", { bubbles: true, composed: true, detail: this.error }));
			return;
		}
		// Client-side schema validation against the same JSON Schema the server
		// exposes through `findStep().inputSchema`. Single source of truth: the
		// Zod schema on the server. Validating here gives the user inline,
		// per-field feedback before the RPC roundtrip.
		const fieldErrors = validateStepInput(params, this.descriptor.inputSchema as Parameters<typeof validateStepInput>[1]);
		if (fieldErrors.length > 0) {
			this.fieldErrors = collectFieldErrors(fieldErrors);
			this.error = `invalid input: ${fieldErrors.map((e) => `${e.field} ${e.message}`).join("; ")}`;
			this.loading = false;
			this._executed = true;
			this.renderComponent();
			this.dataset.testid = `${this.idPrefix()}-step-error`;
			this.dispatchEvent(new CustomEvent("step-error", { bubbles: true, composed: true, detail: this.error }));
			return;
		}
		this.fieldErrors = {};
		const client = SseClient.for("");

		try {
			const method = this.descriptor.method;
			this.result = await inAction((scope) => client.rpc(scope, method, params));
			const action = dispatchAffordanceFromResponse(this.result);
			void inAction(async (scope) => {
				await SseClient.for("").rpc(scope, "MonitorStepper-logClient", {
					event: {
						level: "info",
						source: "shu-step-caller",
						message: `step ${method} returned action.kind=${action.kind}`,
						attributes: { "haibun.shu.step-caller.method": method, "haibun.shu.step-caller.action": action.kind },
					},
				});
			}).catch(() => undefined);
			this.dispatchEvent(
				new CustomEvent("step-success", {
					bubbles: true,
					composed: true,
					detail: this.result,
				}),
			);
		} catch (err) {
			this.error = errorDetail(err);
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
		this.dataset.testid = `${this.idPrefix()}-${this.error ? "step-error" : "step-result"}`;
		this.scrollIntoView({ behavior: "smooth", block: "nearest" });
	}

	/**
	 * Unique per-invocation testid prefix: `${gwta}-${callIndex}` where
	 * `gwta` is the user-facing step pattern (e.g. "show affordances") that the
	 * actions bar threads through, and `callIndex` is the count of prior callers
	 * for the same method. Falls back to the qualified method when no gwta is
	 * supplied (defensive, for callers that mount step-caller directly without
	 * going through the actions bar). Using gwta keeps test selectors readable
	 * — feature files target "show affordances-0-step-run" rather than
	 * "GoalResolutionStepper-showAffordances-0-step-run".
	 */
	private idPrefix(): string {
		const key = this.getAttribute("gwta") || this.getAttribute("method") || this.getAttribute("step") || "";
		const callIndex = this.getAttribute("call-index") ?? "0";
		return `${key}-${callIndex}`;
	}

	private renderComponent(): void {
		if (!this.shadowRoot) return;
		const desc = this.descriptor;
		const stepName = this.getAttribute("step") || "";
		const prefix = this.idPrefix();

		const dismissBtn = this.executed ? '<button class="dismiss-btn" title="Remove">x</button>' : "";

		this.shadowRoot.innerHTML = `
			${this.css()}
			<div class="step-caller" data-testid="step-caller-${esc(stepName)}">
				${dismissBtn}
				${desc && !this.hasAttribute("auto") ? this.renderForm(desc) : ""}
				${this.loading ? `<div class="loading" data-testid="${esc(prefix)}-step-loading">loading...</div>` : ""}
				${this.result !== null ? `<div data-testid="${esc(prefix)}-step-result">${this.renderOutput()}</div>` : ""}
				${this.error ? `<div class="error" data-testid="${esc(prefix)}-step-error">${esc(this.error)}</div>` : ""}
				${!this.error && this.result !== null && !desc?.outputSchema ? `<div class="success" data-testid="${esc(prefix)}-step-success">done</div>` : ""}
				${this._executed ? `<div hidden data-testid="${esc(prefix)}-step-done"></div>` : ""}
			</div>
		`;
		this.bindEvents();
	}

	private renderForm(desc: StepDescriptor): string {
		const schema = desc.inputSchema as { properties?: Record<string, InputProperty>; required?: string[] } | undefined;
		const properties = schema?.properties || {};
		const prefix = this.idPrefix();
		const tid = (suffix: string) => ` data-testid="${escAttr(prefix)}-${escAttr(suffix)}"`;

		// Parse the gwta pattern into text segments and inline inputs
		const pattern = prettifyGwta(desc.pattern || "");
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
						`<select name="${escAttr(paramName)}" class="inline-select"${tid(`step-input-${paramName}`)}><option value=""${!savedVal ? " selected" : ""}>${esc(paramName)}</option>${options}</select>`,
					);
				} else if (this.refTargetLabel(desc, paramName)) {
					// Vertex-ref input: the parameter is a single-field composite
					// `{id}` whose `id` ranges over a registered vertex domain.
					// Render a combobox populated from the live snapshot of that
					// vertex type instead of asking the user to type an id from
					// memory. The combobox propagates `testid` to its inner
					// `<input>` so Playwright's `fill()` (and the existing
					// `setValue` step) work directly. A hidden `${paramName}.id`
					// input carries the chosen id into the form's submit handler.
					const targetLabel = this.refTargetLabel(desc, paramName) ?? "";
					const saved = this.lastFormValues[`${paramName}.id`] || "";
					const innerTestId = `${prefix}-step-input-${paramName}`;
					parts.push(
						`<span class="ref-input" data-param="${escAttr(paramName)}">` +
							`<shu-combobox testid="${escAttr(innerTestId)}" data-vertex-ref="${escAttr(targetLabel)}" data-param="${escAttr(paramName)}" placeholder="${escAttr(paramName + " (pick or type id)")}"></shu-combobox>` +
							`<input type="hidden" name="${escAttr(paramName + ".id")}" value="${escAttr(saved)}" />` +
							`</span>`,
					);
				} else if (isCompositeProperty(prop)) {
					const subInputs: string[] = [];
					const required = new Set(prop.required ?? []);
					for (const [subName, subProp] of Object.entries(prop.properties)) {
						const fullName = `${paramName}.${subName}`;
						// `data-testid` uses `-` joins (not `.`) so haibun's variable
						// resolver doesn't parse `foo.bar` as a dot-path traversal.
						const testIdName = `${paramName}-${subName}`;
						const saved = this.lastFormValues[fullName] || "";
						const requiredMark = required.has(subName) ? "" : "?";
						// `format` (e.g. "uri", "email", "date-time") wins over the base
						// `type` so a `z.url()` field shows "uri" rather than "string".
						// A field with neither is a schema bug — the JSON Schema producer
						// must declare one or the other.
						const format = (subProp as { format?: string }).format;
						const typeLabel = format ?? subProp.type;
						if (!typeLabel) throw new Error(`shu-step-caller: composite sub-field "${fullName}" has no \`type\` or \`format\` in its JSON Schema. The schema producer must declare one.`);
						const placeholder = `${subName}${requiredMark}: ${typeLabel}`;
						const sz = Math.max(saved.length, placeholder.length, 4);
						const fieldError = this.fieldErrors[fullName];
						const errSpan = fieldError ? `<span class="field-error"${tid(`step-input-${testIdName}-error`)}>${esc(fieldError)}</span>` : "";
						subInputs.push(
							`<input type="${subProp.type === "number" ? "number" : "text"}" name="${escAttr(fullName)}" class="inline-input" placeholder="${escAttr(placeholder)}" value="${escAttr(saved)}" size="${sz}"${tid(`step-input-${testIdName}`)} />${errSpan}`,
						);
					}
					parts.push(`<span class="composite-input" data-param="${escAttr(paramName)}">${subInputs.join(" ")}</span>`);
				} else {
					const saved = this.lastFormValues[paramName] || "";
					const sz = Math.max(saved.length, paramName.length, 4);
					const fieldError = this.fieldErrors[paramName];
					const errSpan = fieldError ? `<span class="field-error"${tid(`step-input-${paramName}-error`)}>${esc(fieldError)}</span>` : "";
					parts.push(
						`<input type="text" name="${escAttr(paramName)}" class="inline-input" placeholder="${escAttr(paramName)}" value="${escAttr(saved)}" size="${sz}"${tid(`step-input-${paramName}`)} />${errSpan}`,
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

		// Object: unwrap single-property containers, otherwise render each property via its own schema branch (so an array-of-object property renders as a nested table, not stringified JSON).
		if (jsonSchema.type === "object" && jsonSchema.properties) {
			const props = jsonSchema.properties;
			const keys = Object.keys(props);
			const obj = data as Record<string, unknown>;
			if (keys.length === 1) {
				const inner = obj[keys[0]];
				if (inner !== undefined) return this.renderBySchema(inner, props[keys[0]]);
			}
			const entries = keys
				.filter((k) => obj[k] !== undefined)
				.map((k) => `<dt>${esc(k)}</dt><dd data-testid="step-result-${escAttr(k)}">${this.renderBySchema(obj[k], props[k])}</dd>`)
				.join("");
			return `<dl>${entries}</dl>`;
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

			// Vertex-ref combobox wiring. Each `shu-combobox[data-vertex-ref]`
			// is populated from a live snapshot of that vertex label, and its
			// picked value flows into the hidden `${param}.id` input that the
			// form's submit handler reads.
			form.querySelectorAll<HTMLElement & { setOptions?: (opts: TComboboxOption[]) => void }>("shu-combobox[data-vertex-ref]").forEach((cb) => {
				const targetLabel = cb.dataset.vertexRef;
				const paramName = cb.dataset.param;
				if (!targetLabel || !paramName) return;
				const hidden = form.querySelector<HTMLInputElement>(`input[name="${CSS.escape(paramName)}\\.id"]`);
				cb.addEventListener("combo-change", (e) => {
					if (hidden) hidden.value = (e as CustomEvent).detail?.value ?? "";
				});
				// A user (or a Playwright test) can type an id directly without
				// picking an option. Mirror the typed text into the hidden input
				// so the submit handler always carries something — `combo-change`
				// will overwrite it later if the user picks from the dropdown.
				const inputEl = cb.shadowRoot?.querySelector("input") as HTMLInputElement | null;
				inputEl?.addEventListener("input", () => {
					if (hidden) hidden.value = inputEl.value;
				});
				void this.populateVertexRef(cb, targetLabel);
			});
		}
	}

	/**
	 * If the named param is a vertex-ref input (its domain is registered as a
	 * reference in the concern catalog), returns the target vertex's label.
	 * `undefined` means render the param as a normal composite or primitive.
	 */
	private refTargetLabel(desc: StepDescriptor, paramName: string): string | undefined {
		const domainKey = desc.paramDomains?.[paramName];
		if (!domainKey) return undefined;
		try {
			const ref = getConcernCatalog().references?.[domainKey];
			return ref?.targetVertexLabel;
		} catch {
			return undefined;
		}
	}

	private async populateVertexRef(cb: HTMLElement & { setOptions?: (opts: TComboboxOption[]) => void }, label: string): Promise<void> {
		try {
			const method = requireStep("graphQuery");
			const data = await inAction((scope) =>
				SseClient.for("").rpc<{ vertices: Array<Record<string, unknown>> }>(scope, method, { query: { label, limit: 50 } }),
			);
			const concerns = getConcernCatalog();
			const vertexConcern = Object.values(concerns.vertices).find((v) => v.label === label);
			const idField = vertexConcern?.idField ?? "id";
			const nameField = this.pickNameField(vertexConcern);
			const options: TComboboxOption[] = (data.vertices ?? []).map((v) => {
				const id = String((v as Record<string, unknown>)[idField] ?? "");
				const name = nameField ? String((v as Record<string, unknown>)[nameField] ?? "") : "";
				return {
					value: id,
					label: name || id,
					secondary: label,
					details: JSON.stringify(v, null, 2),
				};
			});
			cb.setOptions?.(options);
		} catch (err) {
			cb.setOptions?.([{ value: "", label: `(failed to load ${label}: ${errorDetail(err)})` }]);
		}
	}

	/** Pick a field that's the most user-friendly identifier for a vertex (name > title > label). Returns undefined if no candidate exists. */
	private pickNameField(vertexConcern: { properties?: Record<string, unknown> } | undefined): string | undefined {
		if (!vertexConcern?.properties) return undefined;
		for (const candidate of ["name", "title", "label", "subject"]) {
			if (candidate in vertexConcern.properties) return candidate;
		}
		return undefined;
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
			.field-error { display: inline-block; color: #c92a2a; font-size: 11px; margin-left: 4px; }
		</style>`;
	}
}

/** Flatten a list of `{field, message}` errors into a `field → message` map for rendering. */
function collectFieldErrors(errs: TFieldError[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (const e of errs) {
		if (out[e.field]) out[e.field] += `; ${e.message}`;
		else out[e.field] = e.message;
	}
	return out;
}
