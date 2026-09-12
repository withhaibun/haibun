import { esc } from "@haibun/core/lib/document-content.js";

export { esc };

/** Constrain a number to [min, max]. */
export const clamp = (x: number, min: number, max: number): number => Math.min(max, Math.max(min, x));

/** Must stay byte-identical with the same call in shu-step-caller's idPrefix():
 * feature-test selectors converge on this slug regardless of which form (gwta or
 * qualified method) the test typed into the step picker. */
export function normalizeStepKey(input: string): string {
	let s = input.replace(/\{[^}]*\}/g, "");
	if (/^[A-Z]\w+-/.test(s)) s = s.replace(/^[A-Z]\w+-/, "");
	s = s.replace(/([a-z0-9])([A-Z])/g, "$1-$2");
	return s.toLowerCase().replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Render a gwta pattern in human-friendly form. Strips regex-style optional groups
 * `(...)?` (typical of patterns like `set( empty)? {what} as {domain} to {value}`)
 * so labels and inputs show the canonical form without internal regex syntax.
 */
export function prettifyGwta(gwta: string): string {
	if (!gwta) return gwta;
	let out = gwta;
	// Strip optional groups: `(...)?` anywhere.
	out = out.replace(/\(\s*[^()]*?\s*\)\?/g, "");
	// Collapse runs of whitespace produced by stripped groups.
	out = out.replace(/ {2,}/g, " ").trim();
	return out;
}

export function escAttr(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

import { AccessQuery } from "@haibun/core/lib/resources.js";
import { STORED_TYPE_PROP } from "./consts.js";

/**
 * The SPA's current access level. Single source of truth for every RPC caller
 * that reads/writes data, read from the URL hash (`#?access=...`), defaulting
 * to `private` when no override is set. The hash is also where
 * `shu-graph-query` writes an access change from the actions-bar dropdown, so
 * the value round-trips through the URL rather than being held in component
 * state copies.
 */
export function appAccessLevel(): string {
	if (typeof window === "undefined") return AccessQuery.all;
	const hash = window.location.hash;
	if (!hash.startsWith("#?")) return AccessQuery.all;
	const params = new URLSearchParams(hash.slice(2));
	// A reader of this instance sees what it holds, and narrows deliberately: a level answers from that level alone, so
	// opening at one of them would hide everything stored at the others until a reader thought to ask.
	return params.get("access") || AccessQuery.all;
}

import { getSiteMetadataSync } from "./rels-cache.js";

/** First available persisted type from domain metadata. No hard-coded default. */
export function defaultLabel(): string {
	return getSiteMetadataSync()?.types?.[0] ?? "";
}

import { renderRefBody } from "./markdown-refs.js";
import { getRels } from "./rels-cache.js";
/** The one reading style for a record's body text. The body iframe's document and the inline annotated view both use
 *  it, so toggling the annotation gutter never changes how the text reads. */
export const BODY_READING_STYLE = "font-family: sans-serif; font-size: 14px; line-height: 1.5;";

const preBlock = (text: string) => `<pre style="font-family:monospace;white-space:pre-wrap;margin:0;">${esc(text)}</pre>`;

/**
 * THE content renderer: every surface that shows a `content` value renders it here, so markdown and its `#Type:id`
 * links work the same everywhere. A reference renders as <shu-ref> with its link text as child text, so a surface
 * without the element (the sandboxed body iframe) still shows the text. Callers sanitize with `refSanitizeOptions`.
 */
export function renderContentHtml(raw: string, mimeType: string): string {
	if (mimeType === "text/markdown") return renderRefBody(raw, (name) => getRels(name) !== undefined);
	if (mimeType === "text/html") return raw;
	if (mimeType === "application/ld+json" || mimeType === "application/json") {
		try {
			return preBlock(JSON.stringify(JSON.parse(raw), null, 2));
		} catch {
			return preBlock(raw); // not valid JSON, show it verbatim rather than throw
		}
	}
	return preBlock(raw);
}

/** Encode a UTF-8 string as base64 without blowing the call stack on large inputs. */
export function utf8ToBase64(str: string): string {
	const bytes = new TextEncoder().encode(str);
	let binary = "";
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary);
}

/** Label → ID field mapping, populated from server via setIdFields(). */
let idFields: Record<string, string> = {};

/** Set the ID fields mapping (called once from loadMetadata with server data). */
export function setIdFields(fields: Record<string, string>): void {
	idFields = fields;
}

/** Get the identity value from a record. Prefers JSON-LD `@id` (parses the IRI tail) and falls back to label-keyed id fields or common id-bearing fields. */
export function idOf(v: Record<string, unknown>): string {
	const iri = v["@id"];
	if (typeof iri === "string" && iri.length > 0) {
		const slash = iri.indexOf("/");
		if (slash >= 0) return iri.slice(slash + 1);
	}
	const label = v["@type"] as string | undefined;
	if (label && idFields[label]) return String(v[idFields[label]] ?? "");
	return String(v.messageId ?? v.email ?? v.id ?? v.path ?? v.name ?? v.account ?? "");
}

/** A vertex's display label for a list: a human-readable field if present, else its id. */
export function instanceLabel(v: Record<string, unknown>): string {
	return String(v.name ?? v.subject ?? v.email ?? v.filename ?? idOf(v));
}

/** Get the persisted type label: the JSON-LD `@type`. Records reaching the frontend are projected, so `@type` is always present; a record without it is a projection bug and fails naturally downstream. */
export function persistedTypeOf(v: Record<string, unknown>): string {
	return v["@type"] as string;
}

/**
 * SPA-only artifact keys, projection or storage internals that have no domain
 * meaning (no rel) and should not appear in field tables.
 * Anything domain-meaningful (body, hasBody, accessLevel, …) lives in
 * `LinkRelations` with a `presentation` hint instead.
 * `STORED_TYPE_PROP` is the literal storage property the consumer's graph store
 * stamps on parsed graph rows: a storage internal, not the wire `persistedAs` field.
 */
export const SPA_PROPS = new Set([STORED_TYPE_PROP]);

import { getRelPresentation } from "@haibun/core/lib/resources.js";
import { getRelSync } from "./rels-cache.js";

/**
 * True for keys that belong in the field table for `label`. The field table
 * is the default content presentation; rels whose presentation hint puts them
 * in another bucket (body iframe, summary heading, governance section) get
 * filtered out so they render where they belong.
 *
 * Filters:
 *   - projection prefixes `@*` / `_*` and SPA artifacts in `SPA_PROPS`
 *   - keys whose rel-via-label has a non-default presentation
 *   - keys whose name IS itself a known rel (covers inlined edges like
 *     `hasBody` whose property name on the projection is the rel name)
 */
export function isVisibleKey(k: string, label?: string): boolean {
	if (k.startsWith("_") || k.startsWith("@")) return false;
	if (SPA_PROPS.has(k)) return false;
	const directPresentation = getRelPresentation(k);
	if (directPresentation === "body" || directPresentation === "governance") return false;
	if (!label) return true;
	const rel = getRelSync(label, k);
	if (!rel) return true;
	const presentation = getRelPresentation(rel);
	return presentation !== "body" && presentation !== "governance";
}

/** The fields of an individual whose rel is marked `governance`: control over the record (who may see it, what it
 *  allows, whether it is revoked). `isVisibleKey` keeps them out of the field table; this is where they come back. */
export function governanceFields(vertex: Record<string, unknown>, label?: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(vertex)) {
		if (k.startsWith("_") || k.startsWith("@") || v === undefined || v === null) continue;
		const rel = (label ? getRelSync(label, k) : undefined) ?? k;
		if (getRelPresentation(rel) === "governance") out[k] = typeof v === "string" ? v : JSON.stringify(v);
	}
	return out;
}

/**
 * True for edges that belong in the references section. Edges whose rel has a
 * non-default presentation (body, governance) are rendered elsewhere and must
 * not appear as clickable reference links.
 */
export function isReferenceEdge(edgeType: string): boolean {
	const p = getRelPresentation(edgeType);
	return p !== "body" && p !== "governance";
}

/**
 * Extract a node's displayed scalar/array-of-scalar fields for the
 * field-table renderer. Drops:
 *   - rels routed elsewhere by presentation (body / governance)
 *   - SPA artifacts and projection-internal keys
 *   - arrays of objects (those go to the items-table renderer)
 */
export function extractFieldEntries(vertex: Record<string, unknown>, label?: string): Record<string, string | string[]> {
	const fields: Record<string, string | string[]> = {};
	for (const [k, v] of Object.entries(vertex)) {
		if (!isVisibleKey(k, label)) continue;
		if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object") continue;
		fields[k] = Array.isArray(v) ? (v as unknown[]).map((x) => String(x)) : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? "");
	}
	return fields;
}

/**
 * Literal body-presentation fields: an inline scalar whose rel has presentation `body` (e.g. a SeqPath's `stepText`,
 * mapped to `content`). extractFieldEntries routes body-presentation fields out of the field table on the assumption
 * the body path renders them, but that path only handles LINKED `hasBody` sub-resources, so a literal `content`
 * scalar would otherwise render nowhere. Linked bodies (arrays of Body objects) are excluded here by the string test.
 */
export function extractBodyLiterals(vertex: Record<string, unknown>, label?: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(vertex)) {
		if (typeof v !== "string" || v.length === 0 || k.startsWith("_") || k.startsWith("@")) continue;
		const rel = getRelPresentation(k) ? k : label ? getRelSync(label, k) : undefined;
		if (rel && getRelPresentation(rel) === "body") out[k] = v;
	}
	return out;
}

/**
 * Pick the preferred Body sub-resource to display. Order of preference is
 * declarative: readers want markdown when present, plain text when not,
 * HTML last (it's bulky and often noisy after extraction).
 */
// Which reading of a record to use is one rule for every surface, declared in core beside the body it reads; re-exported
// here because this module is where the page's formatting helpers are found.
export { BODY_PREFERENCE, pickPreferredBody } from "@haibun/core/lib/resources.js";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad2(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

function timeStr(d: Date): string {
	return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function startOfWeek(d: Date): Date {
	const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
	const day = copy.getDay();
	// Monday = start of week
	copy.setDate(copy.getDate() - ((day + 6) % 7));
	return copy;
}

const DATE_RE = [/^\d{4}-\d{2}-\d{2}(T|\s)\d{2}:\d{2}/, /^\d{4}-\d{2}-\d{2}$/, /^[A-Z][a-z]{2},?\s+\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4}/];

export function isDateValue(value: string): boolean {
	return DATE_RE.some((re) => re.test(value));
}

export function formatDate(value: string, now: Date = new Date()): string {
	const d = new Date(value);
	if (isNaN(d.getTime())) return value;

	const time = timeStr(d);
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());

	if (target.getTime() === today.getTime()) {
		return `Today, ${time}`;
	}
	if (startOfWeek(target).getTime() === startOfWeek(today).getTime()) {
		return `${DAYS[d.getDay()]} ${time}`;
	}
	const month = MONTHS[d.getMonth()];
	if (d.getFullYear() === now.getFullYear()) {
		return `${month} ${d.getDate()} ${time}`;
	}
	return `${month} ${d.getDate()}, ${d.getFullYear()} ${time}`;
}
