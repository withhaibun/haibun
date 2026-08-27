import { SHU_BASE } from "./styles.js";
import { conduit } from "../hypermedia.js";
import { getAvailableSteps, findStep, requireStep, type StepDescriptor } from "../rpc-registry.js";
import { queryGraph } from "../quads-snapshot.js";
import { dispatchAffordanceFromResponse } from "../affordance-dispatch.js";
import { esc, escAttr, prettifyGwta, normalizeStepKey } from "../util.js";
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
 * sub-property instead of a single stringified-JSON text input. A single input
 * would require hand-typed valid JSON and crash silently on anything else.
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
		// Zod schema on the server. Validating here yields inline, per-field
		// feedback before the RPC roundtrip.
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

		try {
			const method = this.descriptor.method;
			this.result = await conduit().follow({ method, params }, `step-caller: ${method}`);
			dispatchAffordanceFromResponse(this.result);
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

	private idPrefix(): string {
		// Derive the slug from the qualified method so test selectors can build
		// the same id from either side of the wire — `normalizeStepKey` strips
		// the stepper prefix and camelCase-splits the action name, producing a
		// stable kebab-case slug. gwta-derived slugs vary with optional words
		// between params (e.g. "check record X against Y") and diverge from the
		// test helper's `stepInput(method, …)`.
		const key = this.getAttribute("method") || this.getAttribute("step") || this.getAttribute("gwta") || "";
		const callIndex = this.getAttribute("call-index") ?? "0";
		return `${normalizeStepKey(key)}-${callIndex}`;
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
					// Persisted-ref input: the parameter is a single-field composite
					// `{id}` whose `id` ranges over a registered persisted domain.
					// Render a combobox populated from the live snapshot of that
					// persisted type rather than a free-text id field. The combobox
					// propagates `testid` to its inner
					// `<input>` so Playwright's `fill()` (and the existing
					// `setValue` step) work directly. A hidden `${paramName}.id`
					// input carries the chosen id into the form's submit handler.
					const targetLabel = this.refTargetLabel(desc, paramName) ?? "";
					const saved = this.lastFormValues[`${paramName}.id`] || "";
					const innerTestId = `${prefix}-step-input-${paramName}`;
					parts.push(
						`<span class="ref-input" data-param="${escAttr(paramName)}">` +
							`<shu-combobox testid="${escAttr(innerTestId)}" data-persisted-ref="${escAttr(targetLabel)}" data-param="${escAttr(paramName)}" placeholder="${escAttr(paramName + " (pick or type id)")}"></shu-combobox>` +
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
						if (!typeLabel)
							throw new Error(`shu-step-caller: composite sub-field "${fullName}" has no \`type\` or \`format\` in its JSON Schema. The schema producer must declare one.`);
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

			// Persisted-ref combobox wiring. Each `shu-combobox[data-persisted-ref]`
			// is populated from a live snapshot of that persisted type, and its
			// picked value flows into the hidden `${param}.id` input that the
			// form's submit handler reads.
			form
				.querySelectorAll<HTMLElement & { setOptions?: (opts: TComboboxOption[]) => void; updateComplete?: Promise<unknown> }>("shu-combobox[data-persisted-ref]")
				.forEach((cb) => {
					const targetLabel = cb.dataset.persistedRef;
					const paramName = cb.dataset.param;
					if (!targetLabel || !paramName) return;
					const hidden = form.querySelector<HTMLInputElement>(`input[name="${CSS.escape(paramName)}\\.id"]`);
					cb.addEventListener("combo-change", (e) => {
						if (hidden) hidden.value = (e as CustomEvent).detail?.value ?? "";
					});
					// An id can be typed directly without picking an option. Mirror the
					// typed text into the hidden input so the submit handler always
					// carries something — `combo-change` overwrites it on a dropdown pick.
					// `await updateComplete` waits for lit's first render of the
					// combobox's inner `<input>`; without this the `querySelector`
					// returns null because lit's render is scheduled in the next
					// microtask, leaving Playwright's `fill()` unwired.
					const wireInputMirror = () => {
						const inputEl = cb.shadowRoot?.querySelector("input") as HTMLInputElement | null;
						inputEl?.addEventListener("input", () => {
							if (hidden) hidden.value = inputEl.value;
						});
					};
					if (cb.updateComplete) void cb.updateComplete.then(wireInputMirror);
					else wireInputMirror();
					void this.populatePersistedRef(cb, targetLabel);
				});
		}
	}

	/**
	 * If the named param is a persisted-ref input (its domain is registered as a
	 * reference in the concern catalog), returns the target persisted type's label.
	 * `undefined` means render the param as a normal composite or primitive.
	 */
	private refTargetLabel(desc: StepDescriptor, paramName: string): string | undefined {
		const domainKey = desc.paramDomains?.[paramName];
		if (!domainKey) return undefined;
		try {
			const ref = getConcernCatalog().references?.[domainKey];
			return ref?.targetPersistedAs;
		} catch {
			return undefined;
		}
	}

	private async populatePersistedRef(cb: HTMLElement & { setOptions?: (opts: TComboboxOption[]) => void }, label: string): Promise<void> {
		try {
			const data = await queryGraph({ label, limit: 50 });
			const concerns = getConcernCatalog();
			const concern = Object.values(concerns.persisted).find((c) => c.label === label);
			const idField = concern?.idField ?? "id";
			const nameField = this.pickNameField(concern);
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

	/** Pick the most readable identifier field for an individual (name > title > label). Returns undefined if no candidate exists. */
	private pickNameField(vertexConcern: { properties?: Record<string, unknown> } | undefined): string | undefined {
		if (!vertexConcern?.properties) return undefined;
		for (const candidate of ["name", "title", "label", "subject"]) {
			if (candidate in vertexConcern.properties) return candidate;
		}
		return undefined;
	}

	private css(): string {
		return `<style>
			${SHU_BASE}
			:host { display: block; }
			table { width: 100%; border-collapse: collapse; font-size: var(--shu-font-md); }
			th, td { text-align: left; padding: var(--shu-space-2) var(--shu-space-4); border-bottom: var(--shu-border-w) solid var(--shu-border); }
			th { font-weight: normal; color: var(--shu-fg-muted); border-bottom-width: 2px; border-bottom-color: var(--shu-border-strong); }
			.loading { color: var(--shu-fg-muted); font-style: italic; }
			dl { display: grid; grid-template-columns: auto 1fr; gap: var(--shu-space-2) var(--shu-space-5); }
			dt { font-weight: bold; }
			pre { white-space: pre-wrap; font-size: var(--shu-font-md); }
			ul { list-style: none; padding: 0; }
			ul li { padding: var(--shu-space-1) 0; border-bottom: var(--shu-border-w) solid var(--shu-border); }
			.step-sentence {
				display: flex; flex-wrap: wrap; align-items: center; gap: var(--shu-space-2) var(--shu-space-3);
				font: inherit; line-height: 1.6; padding: var(--shu-space-1) 0; color: var(--shu-fg);
			}
			.step-text { color: var(--shu-fg-muted); white-space: nowrap; }
			.step-fixed { color: var(--shu-fg); font-weight: 500; white-space: nowrap; }
			.inline-input, .inline-select {
				font: inherit; font-size: var(--shu-font-md);
				padding: var(--shu-space-1) var(--shu-space-3); margin: 1px 0;
				border: var(--shu-border-w) solid var(--shu-border);
				border-radius: var(--shu-radius);
				background: var(--shu-bg-input); color: var(--shu-fg);
				min-height: var(--shu-input-h);
				outline: none; width: auto;
			}
			.inline-input:focus, .inline-select:focus { border-color: var(--shu-border-strong); background: var(--shu-bg-input-focus); }
			.inline-input::placeholder { color: var(--shu-fg-faded); }
			.run-inline {
				padding: var(--shu-space-1) var(--shu-space-4);
				background: var(--shu-accent); color: var(--shu-accent-fg);
				border: var(--shu-border-w) solid var(--shu-accent);
				border-radius: var(--shu-radius); font: inherit; cursor: pointer;
				margin-left: var(--shu-space-1); font-size: var(--shu-font-md);
				min-height: var(--shu-input-h);
			}
			.run-inline:hover { filter: brightness(1.1); }
			.run-inline.rerun { background: var(--shu-success); border-color: var(--shu-success); }
			.dismiss-btn {
				float: right; background: none; border: none; color: var(--shu-fg-faded);
				cursor: pointer; font-size: var(--shu-font-sm);
				padding: 0 var(--shu-space-2); line-height: 1; width: auto;
			}
			.dismiss-btn:hover { color: var(--shu-error); }
			.field-error { display: inline-block; color: var(--shu-error); font-size: var(--shu-font-sm); margin-left: var(--shu-space-1); }
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
