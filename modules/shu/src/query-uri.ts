/**
 * shu: URI scheme for query links in the graph SPA.
 * Translates between graph query contexts and URI representation.
 * Self-registers as a value renderer for clickable query links.
 */
import { registerValueRenderer } from "./components/value-renderers.js";
import { esc, escAttr } from "./util.js";
import { Access } from "@haibun/core/lib/resources.js";
import { parseFilterParam, serializeFilterParam, type TSearchCondition } from "./schemas.js";

interface QueryContext {
	conditions: TSearchCondition[];
	label?: string;
	textQuery?: string;
	accessLevel?: string;
	vertexId?: string;
}

const SHU_PREFIX = "shu:";

/**
 * Build a `shu:#?...` URI from a query context.
 * The hash portion matches the format used by graph-query's pushHash/readHash.
 */
export function queryContextToUri(ctx: QueryContext): string {
	const params = new URLSearchParams();
	if (ctx.vertexId) params.set("id", ctx.vertexId);
	if (ctx.label) params.set("label", ctx.label);
	if (ctx.accessLevel && ctx.accessLevel !== Access.private) params.set("access", ctx.accessLevel);
	if (ctx.textQuery) params.set("q", ctx.textQuery);
	for (const c of ctx.conditions) {
		if (c.predicate && c.value) params.append("f", serializeFilterParam(c));
	}
	return `${SHU_PREFIX}#?${params.toString()}`;
}

export function isQueryUri(value: string): boolean {
	return value.startsWith(SHU_PREFIX);
}

/** Strip the `shu:` prefix, returning the `#?...` hash portion. */
export function queryUriToHash(uri: string): string {
	return uri.slice(SHU_PREFIX.length);
}

/** Human-readable label: vertexId + label + conditions summary. */
export function queryUriToLabel(uri: string): string {
	const hash = queryUriToHash(uri);
	const params = new URLSearchParams(hash.slice(2));
	const parts: string[] = [];
	const id = params.get("id");
	if (id) parts.push(id);
	const label = params.get("label");
	if (label) parts.push(label);
	const q = params.get("q");
	if (q) parts.push(`"${q}"`);
	for (const f of params.getAll("f")) {
		const c = parseFilterParam(f);
		parts.push(`${c.predicate} ${c.operator} ${c.value}`);
	}
	return parts.join(", ") || "query";
}

/** Parse a shu: URI back into a payload object. */
export function queryUriToPayload(uri: string): Record<string, unknown> {
	const hash = queryUriToHash(uri);
	const params = new URLSearchParams(hash.slice(2));
	const payload: Record<string, unknown> = {};
	const id = params.get("id");
	if (id) payload.vertexId = id;
	const label = params.get("label");
	if (label) payload.label = label;
	const access = params.get("access");
	payload.accessLevel = access || Access.private;
	const q = params.get("q");
	if (q) payload.textQuery = q;
	const filterParams = params.getAll("f");
	if (filterParams.length > 0) payload.conditions = filterParams.map(parseFilterParam);
	return payload;
}

// Self-register as a value renderer — display query links as clickable
registerValueRenderer({
	detect: isQueryUri,
	render(value: string): string {
		return `<a class="query-link col-link" href="#" data-testid="query-link" data-query-uri="${escAttr(value)}">${esc(value)}</a>`;
	},
});
