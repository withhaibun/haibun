/**
 * Shared document content generation for academic-paper-style rendering.
 * Used by @haibun/shu (vanilla web components) to render actuality document.
 * Pure functions: it doesn't import the DOM.
 */
import { RecordsSchema } from "./json-text.js";
import { itemAt } from "./util/item-at.js";
import type { THaibunEvent, TArtifactEvent, THaibunLogLevel, TStepEvent, TLifecycleEvent, TLogEvent, TJsonArtifact } from "../schema/protocol.js";
import { HAIBUN_LOG_LEVELS } from "../schema/protocol.js";
import { parseRecordName } from "./seq-path.js";
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
				map.get(parentId)?.push({
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

/** Generate markdown + data-attribute HTML for document view. Returns raw markdown string and set of visible event IDs.
 *
 * `baseTime` is the epoch each row's `data-raw-time` is measured from. It defaults to the first event's timestamp, but a
 * windowed caller (one that renders only a tail slice of a longer log) MUST pass its stable global start so the offsets
 * stay comparable across renders: the document's time-cursor arithmetic adds `data-raw-time` back to that same global
 * start, so a per-slice base would scrub every clicked row to a wrong, earlier instant. */
/** The name of a heading as it can be written in a link: lower case, with every run of anything else as a single
 *  hyphen. A feature that lists its own scenarios links to them this way, which is the only handle an author has
 *  before actuality exists: the block ids beside it are assigned while running. */
/** The test id of a heading's block: this prefix and the heading's anchor. */
/**
 * Text as text, wherever a run's own words are placed in markup. What a run logs is arbitrary: a step's text quotes
 * markup on purpose, and a failure's report quotes the elements it looked at. Placed unescaped, those words become
 * elements: one such report put a list item carrying a test id, and three canvases the rendering library then sized,
 * into the document, where the next run found them and pressed one.
 */
export function esc(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const DOC_HEADING_TEST_ID = "doc-heading-";

export function headingAnchor(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

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

	// Claiming and emitting the holder are ONE act: whatever an event claims must get a holder the renderer fills, or an
	// artifact whose event arrives after its claimer is claimed and then isn't rendered (the standalone branch skips
	// claimed ids), making artifact visibility depend on event order. Every claiming branch calls this, never claimArtifacts
	// alone. Returns { ids, holder } so a branch can also stamp the ids on its own row (the technical log-row does).
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

		// A step is rendered once, because a step is one thing that happened. What kind of thing it was decides how it
		// reads: a feature or a scenario is a heading, a technical step a compact row, anything else the prose it states.
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
				// Named by its own heading twice over: `data-heading` is what a link in the document resolves to, and the test id is
				// what a feature waits for to know its heading is on the page: the one handle an author has before actuality exists.
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

					// How deep a step sits is its place in actuality, which is its path within the execution: the execution
					// leading its id names which run it is, not where in that run it sits.
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
