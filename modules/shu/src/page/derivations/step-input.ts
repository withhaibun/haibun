/**
 * A step input's errors against the JSON Schema of the step's input, and the slash command at the start of an input line
 * of the actions bar. The site states each step's input schema from the step's Zod schema (`z.toJSONSchema()`), and a page
 * checks a form's values against it before it sends them. The check reads `type`, `format` (uri, email, date-time),
 * `enum`, `required`, `minLength`, `minimum`, and nested objects and arrays, and passes any other keyword. The site
 * validates every call again and rejects an invalid input with 422.
 */
import { RecordSchema } from "@haibun/core/lib/domains/json-text.js";
import { BAR_MODES } from "../../domains/schemas.js";

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

/** Returns the errors of `value` against `schema`. Each error names the path of its field, so a form renders its message
 *  beside the field's input. */
function validateAgainstSchema(value: unknown, schema: TJsonSchema, fieldPath: string): TFieldError[] {
	const errors: TFieldError[] = [];
	if (value === undefined || value === null || value === "") {
		// The parent level checks whether a value is required (whether this node is
		// required isn't knowable without context). Empty values short-circuit
		// other checks since "must be a uri" on undefined is unhelpful noise.
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
			if (schema.minLength !== undefined && value.length < schema.minLength)
				errors.push({ field: fieldPath, message: `must be at least ${schema.minLength} character${schema.minLength === 1 ? "" : "s"}` });
			if (schema.format === "uri" || schema.format === "url") {
				if (!URI_PATTERN.test(value)) errors.push({ field: fieldPath, message: `must be a uri (e.g. did:web:example.com or https://…), got "${value}"` });
			} else if (schema.format === "email") {
				if (!EMAIL_PATTERN.test(value)) errors.push({ field: fieldPath, message: `must be an email address, got "${value}"` });
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
		const fields = RecordSchema.safeParse(value);
		if (!fields.success) errors.push({ field: fieldPath, message: "must be an object" });
		else {
			const obj = fields.data;
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

/** Returns the errors of a step's `params` against its `inputSchema`, each with the path of its field. */
export function validateStepInput(params: Record<string, unknown>, inputSchema: TJsonSchema | undefined): TFieldError[] {
	if (!inputSchema) return [];
	return validateAgainstSchema(params, inputSchema, "");
}

/** A leading slash in an input line of the actions bar names one of the bar's modes, or `stop`, and the rest of the line
 *  is entered in that mode's input line. A leading double slash enters the line with one slash, as text. */
const SLASH = "/";
/** The command that stops the running turn, as the ask pane's Stop control does. */
export const STOP_COMMAND = "stop";
export type TBarMode = (typeof BAR_MODES)[number];

/** The commands a leading slash names: each mode the bar's schema declares, and stop. */
export const SLASH_COMMANDS: readonly string[] = [...BAR_MODES, STOP_COMMAND];

export type TSlashCommand = { kind: "mode"; mode: TBarMode; rest: string } | { kind: "stop" } | { kind: "literal"; text: string } | { kind: "unknown"; name: string };

/** An input line of a mode, which enters text as the reader typing it does. */
export type TInputLine = { enter(text: string): void | Promise<void> };

const isBarMode = (name: string): name is TBarMode => (BAR_MODES as readonly string[]).includes(name);

/** Returns the command at the start of a line, or undefined where the line doesn't start with a slash. */
export function readSlashCommand(line: string): TSlashCommand | undefined {
	if (!line.startsWith(SLASH)) return undefined;
	if (line.startsWith(SLASH + SLASH)) return { kind: "literal", text: line.slice(SLASH.length) };
	const [, name, rest] = /^\/(\S*)\s*([\s\S]*)$/.exec(line) ?? ["", "", ""];
	if (isBarMode(name)) return { kind: "mode", mode: name, rest };
	return name === STOP_COMMAND ? { kind: "stop" } : { kind: "unknown", name };
}

/** The commands, as a refusal of an unknown one lists them. */
export const commandList = (): string => SLASH_COMMANDS.map((command) => `${SLASH}${command}`).join(", ");
