/**
 * Client-side validator for step-input form values against the JSON Schema
 * the server exposes through `findStep().inputSchema`. Single source of
 * truth is the server's Zod schema (run through `z.toJSONSchema()`); the
 * browser receives the same schema in the step descriptor and validates
 * locally before submit. No duplicate logic — the browser just walks
 * the same shape the server already emits.
 *
 * Covers the JSON-Schema features step inputs actually use: `type`,
 * `format` (uri / email / date-time), `enum`, `required`, `minLength`,
 * `minimum`, and nested object/array structures. Anything else passes
 * through; the server still validates strictly and returns 422 on edge
 * cases, so the client validator is an early-warning, not a gate.
 */

export type TFieldError = { field: string; message: string };

type TJsonSchema = {
	type?: string;
	format?: string;
	enum?: unknown[];
	required?: string[];
	properties?: Record<string, TJsonSchema>;
	items?: TJsonSchema;
	minLength?: number;
	minimum?: number;
};

const URI_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/**
 * Validate a single value against a JSON Schema fragment. Returns the
 * accumulated errors, each tagged with a `field` path so the form can
 * render the message next to the right input.
 */
export function validateAgainstSchema(value: unknown, schema: TJsonSchema, fieldPath = ""): TFieldError[] {
	const errors: TFieldError[] = [];
	if (value === undefined || value === null || value === "") {
		// Required-checking lives at the parent level (we don't know if this
		// node is required without context). Empty values short-circuit other
		// checks since "must be a uri" on undefined is unhelpful noise.
		return errors;
	}
	if (schema.enum && !schema.enum.includes(value)) errors.push({ field: fieldPath, message: `must be one of: ${schema.enum.join(", ")}` });
	if (schema.type === "number" || schema.type === "integer") {
		const n = typeof value === "number" ? value : Number(value);
		if (!Number.isFinite(n)) errors.push({ field: fieldPath, message: "must be a number" });
		else if (schema.minimum !== undefined && n < schema.minimum) errors.push({ field: fieldPath, message: `must be ≥ ${schema.minimum}` });
		return errors;
	}
	if (schema.type === "string" || (schema.type === undefined && typeof value === "string")) {
		if (typeof value !== "string") errors.push({ field: fieldPath, message: "must be a string" });
		else {
			if (schema.minLength !== undefined && value.length < schema.minLength) errors.push({ field: fieldPath, message: `must be at least ${schema.minLength} character${schema.minLength === 1 ? "" : "s"}` });
			if (schema.format === "uri" || schema.format === "url") {
				if (!URI_PATTERN.test(value)) errors.push({ field: fieldPath, message: `must be a uri (e.g. did:web:example.com or https://…) — got "${value}"` });
			} else if (schema.format === "email") {
				if (!EMAIL_PATTERN.test(value)) errors.push({ field: fieldPath, message: `must be an email address — got "${value}"` });
			} else if (schema.format === "date-time") {
				if (!DATE_TIME_PATTERN.test(value)) errors.push({ field: fieldPath, message: "must be an ISO 8601 date-time" });
			}
		}
		return errors;
	}
	if (schema.type === "array") {
		if (!Array.isArray(value)) errors.push({ field: fieldPath, message: "must be an array" });
		else if (schema.items) {
			value.forEach((item, i) => {
				errors.push(...validateAgainstSchema(item, schema.items as TJsonSchema, `${fieldPath}[${i}]`));
			});
		}
		return errors;
	}
	if (schema.type === "object" && schema.properties) {
		if (typeof value !== "object" || Array.isArray(value)) errors.push({ field: fieldPath, message: "must be an object" });
		else {
			const obj = value as Record<string, unknown>;
			for (const [k, sub] of Object.entries(schema.properties)) {
				const subPath = fieldPath ? `${fieldPath}.${k}` : k;
				const present = obj[k] !== undefined && obj[k] !== null && obj[k] !== "";
				if (!present && (schema.required ?? []).includes(k)) {
					errors.push({ field: subPath, message: "required" });
					continue;
				}
				if (present) errors.push(...validateAgainstSchema(obj[k], sub, subPath));
			}
		}
		return errors;
	}
	return errors;
}

/**
 * Top-level helper: validate the assembled `params` record against the
 * step's `inputSchema`. Returns a flat list of `{field, message}` errors
 * grouped by field path so the caller can render them inline.
 */
export function validateStepInput(params: Record<string, unknown>, inputSchema: TJsonSchema | undefined): TFieldError[] {
	if (!inputSchema) return [];
	return validateAgainstSchema(params, inputSchema);
}
