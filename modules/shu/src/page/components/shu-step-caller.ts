/**
 * <shu-step-caller>: a step's form, its call, and what the call returned. The form reads the step's pattern as a sentence,
 * with an input for each parameter its input schema declares; a press of its run control validates the values against the
 * schema the server holds, calls the step, and shows the result by the step's output schema, or its refusal.
 *
 * Attributes:
 *   step: the method of the step the form calls
 *   call-index: the caller's number among the callers of its step, which its test ids carry
 *   auto: the form calls the step when it connects, without showing its inputs
 *   params: JSON of fixed parameters, which the form shows and merges with its values
 */
import { html, css, nothing, type TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { TStepDefinition } from "@haibun/core/lib/step-discovery.js";
import { JsonObjectTextSchema, RecordSchema, RecordsSchema } from "@haibun/core/lib/domains/json-text.js";
import { itemAt, valueAt } from "@haibun/core/lib/domains/item-at.js";
import { errorDetail } from "@haibun/core/lib/domains/util.js";
import { SHU_EVENT, SHU_TAG } from "../../domains/elements.js";
import { defineElement } from "../controllers/element-controller.js";
import { getConcernCatalog } from "../controllers/catalog-controller.js";
import { queryRead } from "../controllers/read-controller.js";
import { StepCallController } from "../controllers/step-call-controller.js";
import { validateStepInput, type TFieldError } from "../derivations/step-input.js";
import { prettifyGwta, normalizeStepKey } from "../derivations/steps.js";
import { dispatchAffordanceFromResponse } from "../controllers/affordance-dispatch.js";
import { revealInDocument } from "./reveal.js";
import type { TComboboxOption } from "../../domains/schemas.js";
import type { TPageRefusal } from "../domains/refusal.js";
import { ShuElement, EmptyStateSchema, type TLinkedData } from "./shu-element.js";
import { jsonDisclosure } from "./json-disclosure.js";
import { shuBaseStyles } from "./styles.js";
import "./shu-combobox.js";
import "./shu-refusal.js";

type TInputProperty = {
	type?: string;
	format?: string;
	description?: string;
	enum?: string[];
	properties?: Record<string, TInputProperty>;
	required?: string[];
	[key: string]: unknown;
};
type TInputSchema = { properties?: Record<string, TInputProperty>; required?: string[] };

/** A parameter of a pattern: `{name}` or `{name: domain}`. */
const PARAM = /\{(\w+)(?::\s*[^}]*)?\}/g;
/** The fields a record's options read for its name, in order. */
const NAME_FIELDS = ["name", "title", "label", "subject"];
/** How many records a reference's options offer. */
const REFERENCE_OPTIONS = 50;

/** Whether an input property is a composite (an object schema with properties), which the form renders one field at a
 *  time rather than as JSON. */
function isCompositeProperty(prop: TInputProperty | undefined): prop is TInputProperty & { properties: Record<string, TInputProperty> } {
	return prop?.type === "object" && prop.properties !== undefined && Object.keys(prop.properties).length > 0;
}

/** Returns the refused fields' causes, by field. */
function collectFieldErrors(errs: TFieldError[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (const e of errs) out[e.field] = out[e.field] === undefined ? e.message : `${out[e.field]}; ${e.message}`;
	return out;
}

/** Returns a form value as its property's type states it: JSON for an object or an array, a number for a number. */
function typedValue(value: string, type: string | undefined): unknown {
	if ((type === "object" || type === "array") && value !== "") return JSON.parse(value);
	if (type === "number" && value !== "") return Number(value);
	return value;
}

export class ShuStepCaller extends ShuElement<typeof EmptyStateSchema> {
	/** A form doesn't contribute to a conversation's context; what its call returned does, through the step's products. */
	summarizeForContext(): TLinkedData | null {
		return null;
	}

	static styles = [
		shuBaseStyles,
		css`
			:host { display: block; }
			table { width: 100%; border-collapse: collapse; font-size: var(--shu-font-md); }
			th, td { text-align: left; padding: var(--shu-space-2) var(--shu-space-4); border-bottom: var(--shu-border-w) solid var(--shu-border); }
			th { font-weight: normal; color: var(--shu-fg-muted); border-bottom-width: 2px; border-bottom-color: var(--shu-border-strong); }
			.loading { color: var(--shu-fg-muted); font-style: italic; }
			dl { display: grid; grid-template-columns: auto 1fr; gap: var(--shu-space-2) var(--shu-space-5); }
			dt { font-weight: bold; }
			ul { list-style: none; padding: 0; }
			ul li { padding: var(--shu-space-1) 0; border-bottom: var(--shu-border-w) solid var(--shu-border); }
			.step-sentence { display: flex; flex-wrap: wrap; align-items: center; gap: var(--shu-space-2) var(--shu-space-3); line-height: 1.6; padding: var(--shu-space-1) 0; }
			.step-text { color: var(--shu-fg-muted); white-space: nowrap; }
			.step-fixed { font-weight: 500; white-space: nowrap; }
			.inline-input, .inline-select { font: inherit; width: auto; }
			.dismiss-btn { float: right; }
			.field-error { display: inline-block; color: var(--shu-error); font-size: var(--shu-font-sm); margin-left: var(--shu-space-1); }
		`,
	];

	@property() accessor step = "";
	@property({ attribute: "call-index" }) accessor callIndex = "0";
	@property({ type: Boolean }) accessor auto = false;
	@property() accessor params = "";
	/** The values its inputs start with, by parameter, each a term a statement gave it, which a reader changes before the call. */
	@property({ attribute: false }) accessor values: Record<string, string> = {};

	readonly #call = new StepCallController(this);
	@state() private accessor definition: TStepDefinition | undefined = undefined;
	/** Why the form doesn't show, where the page refused its step or its fixed parameters. */
	@state() private accessor unshown: TPageRefusal | undefined = undefined;
	/** The values the form last held, by input name, so a form drawn again keeps them. */
	@state() private accessor formValues: Record<string, string> = {};
	/** The options of each reference parameter, by parameter, and the refusal of a read of them. */
	@state() private accessor referenceOptions: Record<string, TComboboxOption[]> = {};
	@state() private accessor referenceRefusals: Record<string, TPageRefusal> = {};
	/** The id a reader picked or typed for each reference parameter, by parameter. */
	readonly #referenceIds = new Map<string, string>();

	constructor() {
		super(EmptyStateSchema);
	}

	/** Whether the form has called its step, or refused its values. */
	get executed(): boolean {
		return this.#call.executed;
	}

	/** The fixed parameters the `params` attribute states. Throws for text that isn't a JSON object. */
	get #fixed(): Record<string, unknown> {
		if (this.params === "") return {};
		const parsed = JsonObjectTextSchema.safeParse(this.params);
		if (!parsed.success) throw new Error(`<shu-step-caller> params ${this.params} isn't a JSON object`);
		return parsed.data;
	}

	protected override onConnected(): void {
		if (this.definition !== undefined) return;
		void this.#open();
	}

	async #open(): Promise<void> {
		if (this.step === "") throw new Error("<shu-step-caller> connects without the step it calls");
		try {
			const definition = await this.#call.definitionOf(this.step);
			this.#startWith(definition);
			this.definition = definition;
			this.#loadReferences(definition);
		} catch (err) {
			this.unshown = { error: errorDetail(err) };
			return;
		}
		if (this.auto) await this.callStep({});
	}

	/** Starts the form's inputs with its `values`: a reference's as its id, empty where `values` doesn't name it, a composite's
	 *  JSON as the input of each of its fields, and any other's as its input's text. Throws for a composite's value that isn't
	 *  a JSON object. */
	#startWith(desc: TStepDefinition): void {
		const properties = this.#inputSchemaOf(desc).properties;
		for (const param of Object.keys(desc.paramDomains)) if (this.#referenceTarget(desc, param) !== undefined) this.#referenceIds.set(param, "");
		for (const [param, value] of Object.entries(this.values)) {
			if (this.#referenceIds.has(param)) this.#referenceIds.set(param, value);
			else if (isCompositeProperty(properties?.[param])) {
				const fields = Object.entries(JsonObjectTextSchema.parse(value)).map(([field, held]) => [`${param}.${field}`, typeof held === "string" ? held : JSON.stringify(held)]);
				this.formValues = { ...this.formValues, ...Object.fromEntries(fields) };
			} else this.formValues = { ...this.formValues, [param]: value };
		}
	}

	/** The test id prefix: the step's key and the caller's number, which a test builds from the method too. */
	get #prefix(): string {
		return `${normalizeStepKey(this.step)}-${this.callIndex}`;
	}

	/** The step's input schema, where a parameter taking a record's fields takes those the chosen type's schema states, as the
	 *  catalog carries it, so the form renders each field and validates it as the server does. */
	#inputSchemaOf(desc: TStepDefinition): TInputSchema {
		const schema = desc.inputSchema as TInputSchema;
		const properties = { ...schema.properties };
		const fixed = this.#fixed;
		for (const [data, typeParam] of desc.recordData === undefined ? [] : Object.entries(desc.recordData)) {
			const chosen = typeParam in fixed ? fixed[typeParam] : this.formValues[typeParam];
			if (typeof chosen !== "string" || chosen === "") continue;
			const typeSchema = getConcernCatalog().persisted[chosen]?.jsonSchema as TInputProperty | undefined;
			if (typeSchema === undefined) throw new Error(`<shu-step-caller> offers the type ${chosen}, which the catalog doesn't declare`);
			// The catalog states what a record holds, so a field its schema fills by default is one a caller may leave out.
			const defaulted = new Set((typeSchema.properties === undefined ? [] : Object.entries(typeSchema.properties)).flatMap(([field, prop]) => ("default" in prop ? [field] : [])));
			properties[data] = { ...typeSchema, required: (typeSchema.required ?? []).filter((field) => !defaulted.has(field)) };
		}
		return { ...schema, properties };
	}

	/** The persisted type a parameter names a record of, where its domain is a reference the catalog registers. */
	#referenceTarget(desc: TStepDefinition, paramName: string): string | undefined {
		const domainKey = desc.paramDomains[paramName];
		return domainKey === undefined ? undefined : getConcernCatalog().references[domainKey]?.targetPersistedAs;
	}

	/** Reads the options of each reference parameter: the records of its type, each by its id and its name. */
	#loadReferences(desc: TStepDefinition): void {
		for (const paramName of Object.keys(desc.paramDomains)) {
			const label = this.#referenceTarget(desc, paramName);
			if (label !== undefined) void this.#loadReference(paramName, label);
		}
	}

	async #loadReference(paramName: string, label: string): Promise<void> {
		const read = await queryRead({ label, limit: REFERENCE_OPTIONS });
		if (!read.ok) {
			this.referenceRefusals = { ...this.referenceRefusals, [paramName]: read.refusal };
			return;
		}
		const concern = Object.values(getConcernCatalog().persisted).find((c) => c.label === label);
		if (concern === undefined) throw new Error(`<shu-step-caller> offers records of ${label}, which the catalog doesn't declare`);
		const nameField = NAME_FIELDS.find((field) => field in (concern.properties ?? {}));
		const options = read.value.vertices.map((v) => {
			const id = v[concern.idField];
			if (typeof id !== "string") throw new Error(`a ${label} record's id field ${concern.idField} isn't text`);
			const name = nameField === undefined ? undefined : v[nameField];
			return { value: id, label: typeof name === "string" && name !== "" ? name : id, secondary: label, details: JSON.stringify(v, null, 2) };
		});
		this.referenceOptions = { ...this.referenceOptions, [paramName]: options };
	}

	/** Assembles the step's parameters from the form's values, validates them against its input schema, and calls the
	 *  step. A value that doesn't parse, or a field the schema refuses, refuses the form's values without a call. */
	async callStep(values: Record<string, string>): Promise<void> {
		const desc = this.definition;
		if (desc === undefined) throw new Error(`<shu-step-caller> calls ${this.step} before it reads the step's definition`);
		this.formValues = { ...values };
		const schema = this.#inputSchemaOf(desc);
		const params: Record<string, unknown> = { ...this.#fixed };
		try {
			for (const [key, value] of Object.entries(values)) {
				const dot = key.indexOf(".");
				if (dot <= 0) {
					params[key] = typedValue(value, schema.properties?.[key]?.type);
					continue;
				}
				const parent = key.slice(0, dot);
				const sub = key.slice(dot + 1);
				const parentSchema = schema.properties?.[parent];
				if (value === "" && parentSchema?.required?.includes(sub) !== true) continue;
				params[parent] = { ...RecordSchema.optional().parse(params[parent]), [sub]: typedValue(value, parentSchema?.properties?.[sub]?.type) };
			}
		} catch (err) {
			return this.#refuseInput(`invalid input: ${errorDetail(err)}`, {});
		}
		// The schema is the one the server exposes through the step's definition, so the form states each field's cause before a call.
		const fieldErrors = validateStepInput(params, schema as Parameters<typeof validateStepInput>[1]);
		if (fieldErrors.length > 0) return this.#refuseInput(`invalid input: ${fieldErrors.map((e) => `${e.field} ${e.message}`).join("; ")}`, collectFieldErrors(fieldErrors));
		await this.#call.call(desc.method, params);
		const returned = this.#call.returned;
		if (returned === undefined) {
			const refusal = this.#call.refusal;
			this.dispatchEvent(new CustomEvent(SHU_EVENT.STEP_ERROR, { bubbles: true, composed: true, detail: refusal?.error }));
		} else {
			dispatchAffordanceFromResponse(returned.result);
			this.dispatchEvent(new CustomEvent(SHU_EVENT.STEP_SUCCESS, { bubbles: true, composed: true, detail: returned.result }));
		}
		await this.updateComplete;
		revealInDocument(this, { behavior: "smooth", block: "nearest", inline: "nearest" });
	}

	#refuseInput(error: string, fieldErrors: Record<string, string>): void {
		this.#call.refuseInput(error, fieldErrors);
		this.dispatchEvent(new CustomEvent(SHU_EVENT.STEP_ERROR, { bubbles: true, composed: true, detail: error }));
	}

	/** The form's values, by input name: its inputs and selects, and each reference's id. */
	#valuesOf(form: HTMLFormElement): Record<string, string> {
		const values: Record<string, string> = {};
		for (const input of form.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input[name], select[name]")) if (input.value !== "") values[input.name] = input.value;
		for (const [param, id] of this.#referenceIds) if (id !== "") values[`${param}.id`] = id;
		return values;
	}

	#onSubmit = (e: Event): void => {
		e.preventDefault();
		void this.callStep(this.#valuesOf(e.target as HTMLFormElement));
	};

	/** A choice of the type of a record's fields renders that type's fields. */
	#onTypeChosen = (e: Event): void => {
		const form = (e.target as HTMLSelectElement).form;
		if (form === null) throw new Error("<shu-step-caller> holds a type choice outside its form");
		this.formValues = this.#valuesOf(form);
	};

	/** An inline input grows as a reader types. */
	#resize = (e: Event): void => {
		const input = e.target as HTMLInputElement;
		input.size = Math.max(input.value.length, input.placeholder.length, 4) + 1;
	};

	#testId(suffix: string): string {
		return `${this.#prefix}-${suffix}`;
	}

	#fieldError(name: string, testName: string): TemplateResult | typeof nothing {
		const error = this.#call.fieldErrors[name];
		return error === undefined ? nothing : html`<span class="field-error" data-testid=${this.#testId(`step-input-${testName}-error`)}>${error}</span>`;
	}

	#textInput(name: string, testName: string, placeholder: string, type: "text" | "number"): TemplateResult {
		const saved = this.formValues[name] ?? "";
		return html`<input type=${type} name=${name} class="inline-input" placeholder=${placeholder} .value=${saved} size=${Math.max(saved.length, placeholder.length, 4)}
				data-testid=${this.#testId(`step-input-${testName}`)} @input=${this.#resize} />${this.#fieldError(name, testName)}`;
	}

	/** The input of one parameter, by what its schema and domain declare. */
	#paramInput(desc: TStepDefinition, properties: Record<string, TInputProperty>, paramName: string): TemplateResult {
		const fixed = this.#fixed;
		if (paramName in fixed) return html`<span class="step-fixed">${String(fixed[paramName])}</span>`;
		const prop = properties[paramName];
		// A parameter naming the type of a record's fields offers the types the catalog declares.
		const names = (desc.recordData === undefined ? [] : Object.values(desc.recordData)).includes(paramName) ? Object.keys(getConcernCatalog().persisted).sort() : prop?.enum;
		if (names !== undefined) {
			const saved = this.formValues[paramName];
			const typeChoice = (desc.recordData === undefined ? [] : Object.values(desc.recordData)).includes(paramName);
			return html`<select name=${paramName} class="inline-select" data-testid=${this.#testId(`step-input-${paramName}`)} @change=${typeChoice ? this.#onTypeChosen : nothing}>
				<option value="" ?selected=${saved === undefined}>${paramName}</option>${names.map((v) => html`<option value=${v} ?selected=${v === saved}>${v}</option>`)}</select>`;
		}
		const target = this.#referenceTarget(desc, paramName);
		if (target !== undefined) {
			const refusal = this.referenceRefusals[paramName];
			// The combobox carries its test id to its input, so a driver fills it as a text input. A typed id is the value until a pick.
			return html`<span class="ref-input"><shu-combobox testid=${this.#testId(`step-input-${paramName}`)} placeholder=${`${paramName} (pick or type id)`} .accepts=${true} .value=${valueAt(this.#referenceIds, paramName, "the id a reference holds")} .options=${this.referenceOptions[paramName] ?? []}
					@combo-change=${(e: CustomEvent<{ value: string }>) => this.#referenceIds.set(paramName, e.detail.value)}
					@input=${(e: Event) => this.#referenceIds.set(paramName, (e.composedPath()[0] as HTMLInputElement).value)}></shu-combobox>${refusal === undefined ? nothing : html`<shu-refusal .refusal=${refusal}></shu-refusal>`}</span>`;
		}
		if (!isCompositeProperty(prop)) return this.#textInput(paramName, paramName, paramName, "text");
		const required = new Set(prop.required ?? []);
		const fields = Object.entries(prop.properties).map(([subName, subProp]) => {
			// A test id joins with `-`, so haibun's variable resolver doesn't read `foo.bar` as a path.
			const typeLabel = subProp.format ?? subProp.type;
			if (typeLabel === undefined) throw new Error(`<shu-step-caller>: the composite field "${paramName}.${subName}" doesn't declare a type or a format in its JSON Schema`);
			return this.#textInput(
				`${paramName}.${subName}`,
				`${paramName}-${subName}`,
				`${subName}${required.has(subName) ? "" : "?"}: ${typeLabel}`,
				subProp.type === "number" ? "number" : "text",
			);
		});
		return html`<span class="composite-input">${fields}</span>`;
	}

	/** The form: the step's pattern as a sentence, with an input in place of each parameter. */
	#renderForm(desc: TStepDefinition): TemplateResult {
		const properties = this.#inputSchemaOf(desc).properties ?? {};
		const pattern = prettifyGwta(desc.pattern);
		const parts: TemplateResult[] = [];
		let last = 0;
		for (const match of pattern.matchAll(PARAM)) {
			if (match.index > last) parts.push(html`<span class="step-text">${pattern.slice(last, match.index)}</span>`);
			parts.push(this.#paramInput(desc, properties, itemAt(match, 1)));
			last = match.index + match[0].length;
		}
		if (last < pattern.length) parts.push(html`<span class="step-text">${pattern.slice(last)}</span>`);
		const executed = this.#call.executed;
		return html`<form class="step-form step-sentence" @submit=${this.#onSubmit}>${parts}
			<button type="submit" class=${executed ? "run-inline rerun" : "run-inline"} title=${executed ? "Re-run" : "Run"} data-testid=${this.#testId("step-run")}>${executed ? "⟳▶" : "▶"}</button></form>`;
	}

	/** What the call returned, by the step's output schema, or as JSON where the step doesn't declare one. */
	#renderOutput(desc: TStepDefinition, result: unknown): TemplateResult {
		return desc.outputSchema === undefined ? html`${unsafeHTML(jsonDisclosure(result))}` : this.#bySchema(result, desc.outputSchema);
	}

	#bySchema(data: unknown, schema: Record<string, unknown>): TemplateResult {
		const jsonSchema = schema as { type?: string; properties?: Record<string, Record<string, unknown>>; items?: Record<string, unknown> };
		// An object unwraps a container of one property, and otherwise renders each property by its own schema.
		if (jsonSchema.type === "object" && jsonSchema.properties !== undefined) {
			const props = Object.entries(jsonSchema.properties);
			const obj = RecordSchema.parse(data);
			if (props.length === 1) {
				const [key, keySchema] = itemAt(props, 0);
				if (obj[key] !== undefined) return this.#bySchema(obj[key], keySchema);
			}
			return html`<dl>${props.filter(([k]) => obj[k] !== undefined).map(([k, kSchema]) => html`<dt>${k}</dt><dd data-testid=${`step-result-${k}`}>${this.#bySchema(obj[k], kSchema)}</dd>`)}</dl>`;
		}
		if (jsonSchema.type === "array" && Array.isArray(data)) {
			if (jsonSchema.items?.type === "object") return this.#table(RecordsSchema.parse(data));
			return html`<ul>${data.map((v) => html`<li>${this.#cell(v)}</li>`)}</ul>`;
		}
		if (typeof data === "string" || typeof data === "number") return html`<span>${String(data)}</span>`;
		return html`${unsafeHTML(jsonDisclosure(data))}`;
	}

	/** Rows as one table, its columns every field a row has, since a field one row states another may leave out. */
	#table(rows: Record<string, unknown>[]): TemplateResult {
		if (rows.length === 0) return html`<p>The result doesn't hold a row.</p>`;
		const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
		return html`<table><thead><tr>${cols.map((c) => html`<th>${c}</th>`)}</tr></thead><tbody>${rows.map((r) => html`<tr>${cols.map((c) => html`<td>${this.#cell(r[c])}</td>`)}</tr>`)}</tbody></table>`;
	}

	/** A value as the text of its cell: a field a row leaves out is an empty cell. */
	#cell(value: unknown): string {
		if (value === undefined) return "";
		return typeof value === "string" ? value : JSON.stringify(value);
	}

	render(): TemplateResult {
		if (this.unshown !== undefined) return html`<div class="step-caller" data-testid=${`step-caller-${this.step}`}><shu-refusal .refusal=${this.unshown}></shu-refusal></div>`;
		const desc = this.definition;
		if (desc === undefined) return html`<div class="step-caller" data-testid=${`step-caller-${this.step}`}></div>`;
		const call = this.#call;
		const returned = call.returned;
		const refusal = call.refusal;
		// The host carries the outcome's test id, so a driver reads it from the history.
		if (call.executed) this.dataset.testid = this.#testId(refusal === undefined ? "step-result" : "step-error");
		return html`<div class="step-caller" data-testid=${`step-caller-${this.step}`}>
			${call.executed ? html`<button type="button" class="dismiss-btn" title="Remove" @click=${() => this.remove()}>x</button>` : nothing}
			${this.auto ? nothing : this.#renderForm(desc)}
			${call.calling ? html`<div class="loading" data-testid=${this.#testId("step-loading")}>loading...</div>` : nothing}
			${returned === undefined ? nothing : html`<div data-testid=${this.#testId("step-result")}>${this.#renderOutput(desc, returned.result)}</div>`}
			${refusal === undefined ? nothing : html`<div class="error" data-testid=${this.#testId("step-error")}><shu-refusal .refusal=${refusal}></shu-refusal></div>`}
			${returned !== undefined && desc.outputSchema === undefined ? html`<div class="success" data-testid=${this.#testId("step-success")}>done</div>` : nothing}
			${call.executed ? html`<div hidden data-testid=${this.#testId("step-done")}></div>` : nothing}
		</div>`;
	}
}

defineElement(SHU_TAG.STEP_CALLER, ShuStepCaller);
