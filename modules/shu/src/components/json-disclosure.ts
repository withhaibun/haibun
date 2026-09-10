/**
 * A JSON value as nested disclosures: the whole of it, shown with its structure.
 *
 * Everything the value holds is shown, opened, whatever it is. A record read from the graph arrives as JSON-LD, and the
 * `@context` it is written in is part of what it is: a reader looking at a record can see the vocabulary that gives its
 * terms meaning, without asking for it. Nothing here decides that some of a record is worth less than the rest of it.
 *
 * What this adds over printing the JSON is structure: each object and array is named, says what it holds, and indents
 * under what it belongs to, so a reader can follow it and can collapse the parts they are done with. The disclosure is
 * the browser's own, as every other disclosure here is.
 */
import { esc, escAttr } from "../util.js";

/** What a value holds, said in as few words as a summary can carry it. */
function holds(value: unknown): string {
	if (Array.isArray(value)) return value.length === 1 ? "1 item" : `${value.length} items`;
	const keys = Object.keys(value as Record<string, unknown>);
	return keys.length === 1 ? "1 field" : `${keys.length} fields`;
}

/**
 * One value, written so its type is visible: a string in quotes, a number bare, `null` as null. A record holding the
 * string "3" and one holding the number 3 read differently, because they are different, and a reader deciding what a
 * run did cannot be left to guess which they are looking at.
 */
function scalar(value: unknown): string {
	if (value === null) return "null";
	if (value === undefined) return "undefined";
	return typeof value === "string" ? `"${value}"` : String(value);
}

/** What a value holds, each part under the name it is held by: a field by its name, an item by its place. */
function entries(value: unknown): Array<[string, unknown]> {
	return Array.isArray(value) ? value.map((item, at) => [`[${at}]`, item] as [string, unknown]) : Object.entries(value as Record<string, unknown>);
}

/**
 * `value` as HTML: nested disclosures for what has parts, text for what does not, every one of them open. `name` titles
 * the outermost one, and the result is escaped, so a caller embeds it directly.
 */
export function jsonDisclosure(value: unknown, name = ""): string {
	const named = name === "" ? "" : `<span class="json-name">${esc(name)}</span> `;
	if (value === null || typeof value !== "object") return `<div class="json-line" data-testid="json-line">${named}<span class="json-value">${esc(scalar(value))}</span></div>`;
	const parts = entries(value)
		.map(([key, held]) => jsonDisclosure(held, key))
		.join("");
	return `<details class="json-disclosure" open data-testid=${escAttr(`json-${name || "root"}`)}><summary>${named}<span class="json-holds">${esc(holds(value))}</span></summary>${parts}</details>`;
}

/**
 * A literal that carries JSON, shown as what it is: the words before it as words, and the JSON as disclosures.
 *
 * A run says things like `RPC: {"jsonrpc":"2.0",…}` — a few words naming what happened, then the thing itself. Shown as
 * one string it is a line a reader scrolls past; shown this way the words stay readable and what they carry is opened.
 * A literal carrying no JSON is returned as it reads.
 */
export function literalWithJson(text: string): string {
	const at = text.search(/[[{]/);
	if (at >= 0) {
		try {
			const carried = jsonDisclosure(JSON.parse(text.slice(at)));
			const said = text.slice(0, at).trim();
			return `${said === "" ? "" : `<div class="json-said">${esc(said)}</div>`}${carried}`;
		} catch {
			// the braces are part of what was said, not JSON it carries
		}
	}
	return esc(text);
}
