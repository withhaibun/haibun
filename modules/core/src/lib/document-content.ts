/**
 * Generates document content for rendering in the style of an academic paper. The web components of @haibun/shu call
 * these functions to render actuality's document. The functions are pure and don't import the DOM.
 */
import { RecordsSchema } from "./json-text.js";
import { itemAt } from "./util/item-at.js";
import type { THaibunEvent, TArtifactEvent, THaibunLogLevel, TStepEvent, TLifecycleEvent, TLogEvent, TJsonArtifact } from "../schema/protocol.js";
import { HAIBUN_LOG_LEVELS } from "../schema/protocol.js";
import { parseRecordName } from "./actuality/domains/seq-path.js";
import { MEDIA_TYPE } from "./media-types.js";

type TArtifactIndex = { artifactsByStep: Map<string, TArtifactEvent[]>; allArtifactIds: Set<string> };

/** The artifacts a log event's attributes or a lifecycle event's products embed. */
const EmbeddedArtifactsSchema = RecordsSchema.optional();

const normalizeId = (id: string) => id.replace(/^\[|\]$/g, "");

/** Returns the id of the step that produced an artifact. A run-artifact record's id is that step's id followed by `@n`. An
 *  artifact embedded in a step's event has an id that begins with that step's id. */
export function artifactStepId(id: string): string {
	return itemAt(normalizeId(id).split("@"), 0);
}

/** Returns a step id followed by the id of each enclosing step, innermost first. A view attaches an artifact to the first
 *  of these ids that it renders as a row, because the step that produced the artifact can be a substep it doesn't render. */
export function stepAncestors(id: string): string[] {
	const parts = normalizeId(id).split(".");
	return parts.map((_, i) => parts.slice(0, parts.length - i).join("."));
}

/** Groups artifact events by the id of the step that produced each, including artifacts embedded in log and lifecycle
 *  events. */
export function buildArtifactIndex(events: THaibunEvent[]): TArtifactIndex {
	const map = new Map<string, TArtifactEvent[]>();
	const allIds = new Set<string>();

	for (const e of events) {
		if (e.kind === "artifact") {
			allIds.add(e.id);
			const parentId = artifactStepId(e.id);
			if (!map.has(parentId)) map.set(parentId, []);
			map.get(parentId)?.push(e as TArtifactEvent);
		}

		let embeddedArtifacts: Record<string, unknown>[] | undefined;
		if (e.kind === "log") embeddedArtifacts = EmbeddedArtifactsSchema.parse(e.attributes?.artifacts);
		else if (e.kind === "lifecycle" && "products" in e) embeddedArtifacts = EmbeddedArtifactsSchema.parse(e.products?.artifacts);

		if (embeddedArtifacts) {
			const parentId = normalizeId(e.id);
			if (!map.has(parentId)) map.set(parentId, []);
			embeddedArtifacts.forEach((artifact: Record<string, unknown>, idx: number) => {
				const id = `${parentId}.artifact.${idx}`;
				allIds.add(id);
				map
					.get(parentId)
					?.push({
						id,
						timestamp: e.timestamp,
						source: "haibun",
						kind: "artifact",
						artifactType: artifact.artifactType,
						mimetype: artifact.mimetype || MEDIA_TYPE.bytes,
						...artifact,
					} as TArtifactEvent);
			});
		}
	}
	return { artifactsByStep: map, allArtifactIds: allIds };
}

/**
 * Escapes `&`, `<`, `>` and `"`, so text placed in markup renders as text. Logged text can contain markup: a step's text
 * can quote markup, and a failure's report quotes elements of the page. Text placed unescaped becomes elements of the
 * document. A list item or other quoted element with a test id then matches the locator of a later step.
 */
export function esc(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The URL schemes a link on a page may use. A `javascript:` URL runs script, so the set excludes it. */
const WEB_SCHEMES = new Set(["http:", "https:"]);

/** Returns whether a value is a URL whose scheme is in WEB_SCHEMES. */
export const isWebAddress = (value: string): boolean => URL.canParse(value) && WEB_SCHEMES.has(new URL(value).protocol);

/** The test id of a heading's block: this prefix and the heading's anchor. */
const DOC_HEADING_TEST_ID = "doc-heading-";

/** Returns a heading's anchor for a link: lower case, with each sequence of characters other than a-z and 0-9 replaced by
 *  one hyphen, and without leading or trailing hyphens. A feature that lists its own scenarios links to them by anchor.
 *  An author writes an anchor before actuality exists. Actuality assigns block ids during execution, so an author can't
 *  write them in advance. */
export function headingAnchor(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/**
 * Generates the markdown and data-attribute HTML of the document view. Returns the markdown string and the set of
 * visible event ids.
 *
 * Each row's `data-raw-time` is an offset from `baseTime`, which defaults to the first event's timestamp. A windowed
 * caller renders only a tail slice of a longer log, and it must pass the log's stable start time. The document's time
 * cursor adds `data-raw-time` to that start time, so a per-slice base moves the cursor for a clicked row to an earlier,
 * wrong time.
 */
export function generateDocumentMarkdown(
	events: THaibunEvent[],
	artifactsByStep: Map<string, TArtifactEvent[]>,
	minLogLevel: THaibunLogLevel = "info",
	baseTime = events[0]?.timestamp || 0,
): { md: string; visibleIds: Set<string> } {
	let md = "";
	let lastType: "none" | "prose" | "technical" = "none";
	let previousRenderedDepth = 0;
	let previousRenderedId = "";
	const claimedArtifactIds = new Set<string>();
	const visibleIds = new Set<string>();
	const minLevelIndex = HAIBUN_LOG_LEVELS.indexOf(minLogLevel);
	const belowLevel = (e: THaibunEvent) => {
		const levelIndex = HAIBUN_LOG_LEVELS.indexOf(e.level || "info");
		return levelIndex !== -1 && minLevelIndex !== -1 && levelIndex < minLevelIndex;
	};
	// Each artifact attaches to the first id in its step's ancestor list that this page renders as a row.
	const rows = new Set(events.filter((e) => e.kind === "lifecycle" && !belowLevel(e)).map((e) => normalizeId(e.id)));
	const claimable = new Map<string, TArtifactEvent[]>();
	for (const [stepId, artifacts] of artifactsByStep) {
		const claimer = stepAncestors(stepId).find((id) => rows.has(id));
		if (claimer) claimable.set(claimer, [...(claimable.get(claimer) ?? []), ...artifacts]);
	}

	const claimArtifacts = (id: string, excludeTypes: string[] = []) => {
		const nid = normalizeId(id);
		const artifacts = claimable.get(nid) || [];
		const unclaimed = artifacts.filter((a) => !claimedArtifactIds.has(a.id) && !excludeTypes.includes(a.artifactType));
		if (unclaimed.length > 0) {
			unclaimed.forEach((a) => claimedArtifactIds.add(a.id));
			return unclaimed.map((a) => a.id).join(",");
		}
		return "";
	};

	// Claims a row's artifacts other than video and returns their holder in one call. The renderer fills each holder with
	// its artifacts. The standalone branch skips claimed ids, so an artifact claimed without a holder isn't rendered. An
	// artifact whose event follows its claimer's event is claimed before the loop reaches its event, so a view renders it
	// only in the claimer's holder. Every claiming branch calls this function and doesn't call claimArtifacts alone.
	// Returns { ids, holder }, so a branch can also stamp the ids on its own row, as the technical log row does.
	const claimWithHolder = (id: string, nid: string) => {
		const ids = claimArtifacts(id, ["video"]);
		return { ids, holder: ids ? `<div class="feature-artifacts" data-ids="${ids}" data-id="${nid}"></div>\n` : "" };
	};

	const renderedHeaders = new Set<string>();

	for (const [i, e] of events.entries()) {
		if (belowLevel(e)) continue;

		if (e.kind === "artifact" && e.artifactType === "json") {
			const ja = e as TJsonArtifact;
			if (ja.json?.quadObservation) continue;
		}

		if (e.kind === "artifact") {
			if (!claimedArtifactIds.has(e.id)) {
				claimedArtifactIds.add(e.id);
				visibleIds.add(e.id);
				md += `<div class="standalone-artifact" data-id="${e.id}"></div>\n`;
			}
			continue;
		}

		// A feature, scenario or background renders once, as a heading. A technical step renders as a compact row. Any
		// other step renders as the prose it states.
		if (e.kind === "lifecycle") {
			const le = e as TLifecycleEvent;
			if (le.type === "feature" || le.type === "scenario" || (le.type as string) === "background") {
				const headerKey = `${le.type}:${le.featurePath ?? (le.type === "scenario" ? le.scenarioName : undefined) ?? le.id}`;
				if (renderedHeaders.has(headerKey)) continue;
				renderedHeaders.add(headerKey);

				if (lastType === "technical") md += '\n<div class="h-1"></div>\n';
				const rawTime = le.timestamp - baseTime;
				const headingLevel = le.type === "feature" ? 1 : le.type === "scenario" ? 2 : 3;
				const named = le.type === "feature" ? (le.featureName ?? le.featurePath) : le.type === "scenario" ? le.scenarioName : "Background";
				const title = le.type === "feature" ? `Feature: ${named}` : le.type === "scenario" ? `Scenario: ${named}` : named;
				const nid = normalizeId(le.id);
				visibleIds.add(nid);
				// The block carries its heading's anchor twice. A link in the document resolves to `data-heading`. A feature waits
				// on the test id to detect the heading on the page. An author can write both before actuality exists.
				md += `\n<div class="header-block" data-raw-time="${rawTime}" data-id="${nid}" data-heading="${headingAnchor(named)}" data-testid="${DOC_HEADING_TEST_ID}${headingAnchor(named)}">\n\n${"#".repeat(headingLevel)} ${title}\n\n</div>\n`;
				const header = claimWithHolder(le.id, nid);
				if (header.holder) md += `\n${header.holder}`;
				lastType = "prose";
				continue;
			}

			if (le.type === "step") {
				const step = le as TStepEvent;
				const isTechnical = /^[a-z]/.test(step.in || "");

				if (isTechnical) {
					if (lastType !== "technical" && md.length > 0) md += '\n<div class="h-1"></div>\n';

					let isInstigator = false;
					for (const next of events.slice(i + 1)) {
						if (next.id && le.id && next.id.startsWith(le.id + ".") && next.kind === "lifecycle") {
							isInstigator = true;
							break;
						}
						if (next.id === le.id) continue;
						if (next.id && le.id && !next.id.startsWith(le.id)) break;
					}

					// A step's depth is the length of its path within the execution. The execution id that leads the record
					// name identifies the execution, so it doesn't count toward the depth.
					const depth = parseRecordName(String(step.id ?? ""))?.path.length ?? 0;
					const isNested = depth > 3;
					const time = ((step.timestamp - baseTime) / 1000).toFixed(3);
					const rawTime = step.timestamp - baseTime;
					const actionName = step.actionName || "step";
					const showSymbol = previousRenderedId && previousRenderedDepth < depth;
					const nid = normalizeId(le.id);
					visibleIds.add(nid);
					const claimed = claimWithHolder(nid, nid);

					md += `<div class="log-row font-mono text-[11px] text-slate-500 my-0 leading-tight" data-depth="${depth}" data-nested="${isNested}" data-instigator="${isInstigator}" data-show-symbol="${showSymbol}" data-id="${nid}" data-ids="${claimed.ids}" data-time="${time}" data-raw-time="${rawTime}" data-action="${esc(actionName)}" data-has-artifacts="${!!claimed.ids}">${esc(step.in)}</div>\n`;
					md += claimed.holder;
					lastType = "technical";
					previousRenderedDepth = depth;
					previousRenderedId = le.id || "";
				} else {
					if (lastType === "technical") md += '\n<div class="h-1"></div>\n';
					const rawTime = step.timestamp - baseTime;
					const nid = normalizeId(step.id);
					visibleIds.add(nid);
					md += `\n<div class="prose-block" data-raw-time="${rawTime}" data-id="${nid}">\n\n${step.in}\n\n</div>\n`;
					const prose = claimWithHolder(le.id, nid);
					if (prose.holder) md += `\n${prose.holder}`;
					lastType = "prose";
				}
				continue;
			}
		} else if (e.kind === "log") {
			if (lastType !== "technical" && md.length > 0) md += '\n<div class="h-1"></div>\n';
			const logEv = e as TLogEvent;
			const rawTime = logEv.timestamp - baseTime;
			const time = (rawTime / 1000).toFixed(3);
			const nid = normalizeId(logEv.id);
			visibleIds.add(nid);
			md += `<div class="log-row font-mono text-[11px] text-slate-500 my-0 leading-tight" data-id="${nid}" data-raw-time="${rawTime}" data-time="${time}">${esc(logEv.message)}</div>\n`;
			lastType = "technical";
			continue;
		}
	}

	return { md, visibleIds };
}
