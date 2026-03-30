export function esc(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function escAttr(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function truncate(s: string, max = 50): string {
	return s.length > max ? s.slice(0, max) + "..." : s;
}

/** Extract message from unknown error. */
export function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
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

/** Get the identity value from a vertex record using its _label to find the correct ID field. */
export function vertexId(v: Record<string, unknown>): string {
	const label = v._label as string | undefined;
	if (label && idFields[label]) return String(v[idFields[label]] ?? "");
	return String(v.messageId ?? v.email ?? v.id ?? v.path ?? v.name ?? v.account ?? "");
}

/** Get the vertex type label from a vertex record (_label set by server). */
export function vertexLabel(v: Record<string, unknown>): string {
	return String(v._label ?? "");
}

/** Properties hidden from query/column display (large or internal). */
export const HIDDEN_PROPS = new Set(["accessLevel", "body", "bodyHtml", "bodyMarkdown", "markdown", "uid"]);

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

const DATE_RE = [
	/^\d{4}-\d{2}-\d{2}(T|\s)\d{2}:\d{2}/,
	/^\d{4}-\d{2}-\d{2}$/,
	/^[A-Z][a-z]{2},?\s+\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4}/,
];

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
