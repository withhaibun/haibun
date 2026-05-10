export function esc(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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

export function truncate(s: string, max = 50): string {
	return s.length > max ? s.slice(0, max) + "..." : s;
}

/** Extract message from unknown error. */
export function errMsg(err: unknown): string {
	return errorDetail(err);
}

import { Access } from "@haibun/core/lib/resources.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";

/**
 * The SPA's current access level. Single source of truth for every RPC caller
 * that reads/writes data — read from the URL hash (`#?access=...`), defaulting
 * to `private` when no override is set. The hash is also the form
 * `shu-graph-query` writes when the user changes access via the actions-bar
 * dropdown, so the value round-trips through the URL rather than being held
 * in component state copies.
 */
export function appAccessLevel(): string {
	if (typeof window === "undefined") return Access.private;
	const hash = window.location.hash;
	if (!hash.startsWith("#?")) return Access.private;
	const params = new URLSearchParams(hash.slice(2));
	return params.get("access") || Access.private;
}

import { getSiteMetadataSync } from "./rels-cache.js";

/** First available vertex label from domain metadata. No hard-coded default. */
export function defaultLabel(): string {
	return getSiteMetadataSync()?.types?.[0] ?? "";
}

import MarkdownIt from "markdown-it";
const md = new MarkdownIt();

/** Render a content field value to HTML given its MIME type. */
export function renderContentHtml(raw: string, mimeType: string): string {
	if (mimeType === "text/markdown") return md.render(raw);
	if (mimeType === "text/html") return raw;
	return `<pre style="font-family:monospace;white-space:pre-wrap;margin:0;">${esc(raw)}</pre>`;
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

/** Get the identity value from a vertex record. Prefers JSON-LD `@id` (parses the IRI tail) and falls back to label-keyed id fields or common id-bearing fields. */
export function vertexId(v: Record<string, unknown>): string {
	const iri = v["@id"];
	if (typeof iri === "string" && iri.length > 0) {
		const slash = iri.indexOf("/");
		if (slash >= 0) return iri.slice(slash + 1);
	}
	const label = (v["@type"] ?? v._label) as string | undefined;
	if (label && idFields[label]) return String(v[idFields[label]] ?? "");
	return String(v.messageId ?? v.email ?? v.id ?? v.path ?? v.name ?? v.account ?? "");
}

/** Get the vertex type label, preferring JSON-LD `@type` and falling back to legacy `_label`. */
export function vertexLabel(v: Record<string, unknown>): string {
	return String(v["@type"] ?? v._label ?? "");
}

/**
 * SPA-only artifact keys — projection or storage internals that have no domain
 * meaning (no rel) and should not appear in field tables.
 * Anything domain-meaningful (body, hasBody, accessLevel, …) lives in
 * `LinkRelations` with a `presentation` hint instead.
 */
export const SPA_PROPS = new Set(["vertexLabel"]);

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
 * Extract a vertex's displayed scalar/array-of-scalar fields for the
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
 * Pick the preferred Body sub-resource to display. Order of preference is
 * declarative — readers want markdown when present, plain text when not,
 * HTML last (it's bulky and often noisy after extraction).
 */
export const BODY_PREFERENCE: readonly string[] = ["text/markdown", "text/plain", "text/html"];

export function pickPreferredBody<T extends { mediaType?: string; content?: string }>(bodies: readonly T[]): T | undefined {
	const usable = bodies.filter((b) => typeof b.content === "string" && b.content.length > 0 && typeof b.mediaType === "string");
	for (const mt of BODY_PREFERENCE) {
		const hit = usable.find((b) => b.mediaType === mt);
		if (hit) return hit;
	}
	return usable[0];
}

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
