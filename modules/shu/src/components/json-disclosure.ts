/**
 * A JSON value as nested disclosures: what a reader opens, rather than a wall of text.
 *
 * A record read from the graph arrives as JSON-LD, and printed whole it is mostly vocabulary — the `@context` a type is
 * written in is longer than everything the record says. Each object and array becomes a `<details>` a reader opens,
 * summarised by what it holds, so what a record says is visible and what it is written in is one press away. Scalars
 * are shown as they are, since a value with nothing inside it has nothing to open.
 *
 * The disclosure is the browser's own, as every other disclosure here is.
 */
import { esc, escAttr } from "../util.js";

/** How deep a value is opened when it is first shown: the record itself, and nothing further. */
const OPEN_TO_DEPTH = 1;

/** The vocabulary a record is written in, rather than anything it says: shown closed however shallow it is. */
const WRITTEN_IN = new Set(["@context"]);

/** What a value holds, said in as few words as a summary can carry it. */
function holds(value: unknown): string {
	if (Array.isArray(value)) return value.length === 1 ? "1 item" : `${value.length} items`;
	const keys = Object.keys(value as Record<string, unknown>);
	return keys.length === 1 ? "1 field" : `${keys.length} fields`;
}

/** One scalar, as it reads: a string as its text, everything else as JSON writes it. */
function scalar(value: unknown): string {
	return typeof value === "string" ? value : JSON.stringify(value);
}

function entries(value: unknown): Array<[string, unknown]> {
	return Array.isArray(value) ? value.map((item, at) => [String(at), item] as [string, unknown]) : Object.entries(value as Record<string, unknown>);
}

/**
 * `value` as HTML: nested disclosures for what has parts, text for what does not. `name` titles the outermost one, and
 * the result is escaped, so a caller embeds it directly.
 */
export function jsonDisclosure(value: unknown, name = "", depth = 0): string {
	const named = name === "" ? "" : `<span class="json-name">${esc(name)}</span> `;
	if (value === null || typeof value !== "object") return `<div class="json-line" data-testid="json-line">${named}<span class="json-value">${esc(scalar(value))}</span></div>`;
	const open = depth < OPEN_TO_DEPTH && !WRITTEN_IN.has(name) ? " open" : "";
	const parts = entries(value)
		.map(([key, held]) => jsonDisclosure(held, key, depth + 1))
		.join("");
	return `<details class="json-disclosure"${open} data-testid=${escAttr(`json-${name || "root"}`)}><summary>${named}<span class="json-holds">${esc(holds(value))}</span></summary>${parts}</details>`;
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
