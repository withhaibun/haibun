/**
 * Generates document content for rendering in the style of an academic paper. The web components of @haibun/shu call
 * these functions to render actuality's document. The functions are pure and don't import the DOM.
 */
import type { THaibunEvent, TArtifactEvent, THaibunLogLevel, TStepEvent, TLifecycleEvent, TLogEvent } from "./protocol.js";
import { HAIBUN_LOG_LEVELS, isTechnicalStep } from "./protocol.js";
import { parseRecordName } from "../actuality/domains/seq-path.js";
import { z } from "zod";

/** The classes of a row of a step or a log message in the document. */
const LOG_ROW_CLASS = "log-row font-mono text-[11px] text-slate-500 my-0 leading-tight";

/** The artifacts a step's rendered record carries: what it produced, and what it carries for steps the document doesn't
 *  render. The window of records assigns each artifact to one step's row. */
const carriedOf = (e: THaibunEvent): TArtifactEvent[] => ("produced" in e && Array.isArray(e.produced) ? (e.produced as TArtifactEvent[]) : []);

/** Returns whether an artifact's record is carried by a step's row, which renders it in place of a row of its own. */
const isCarried = (e: THaibunEvent): boolean => "carriedBy" in e && e.carriedBy !== undefined;

/** Returns the artifacts the steps among `events` carry, by id. A row's holder names each of them, and a view fills it. */
export const carriedArtifacts = (events: THaibunEvent[]): Map<string, TArtifactEvent> => new Map(events.flatMap(carriedOf).map((artifact) => [artifact.id, artifact]));

/** The steps a rendered artifact record names: the step it is part of, and the step whose row carries it where one does. */
const ArtifactStepsSchema = z.object({ isPartOf: z.string(), carriedBy: z.string().optional() });

/** Returns the id of the step whose row shows an artifact: the row that carries it, else the step that produced it. */
export const stepShowing = (artifact: TArtifactEvent): string => {
	const { isPartOf, carriedBy } = ArtifactStepsSchema.parse(artifact);
	return carriedBy ?? isPartOf;
};

const normalizeId = (id: string) => id.replace(/^\[|\]$/g, "");

/** Returns a step id followed by the id of each enclosing step, innermost first. A view that reveals the row of a step
 *  another view names reveals the first of these ids that it renders as a row, because the named step can be a substep it
 *  doesn't render. */
export function stepAncestors(id: string): string[] {
	const parts = normalizeId(id).split(".");
	return parts.map((_, i) => parts.slice(0, parts.length - i).join("."));
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
 *  An author writes an anchor before actuality exists. Actuality assigns block ids as its steps run, so an author can't
 *  write them in advance. */
export function headingAnchor(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/**
 * Generates the markdown and data-attribute HTML of the document view. Returns the markdown string and the set of
 * visible event ids. A step's row holds the artifacts its rendered record carries. An artifact renders at its own
 * place where a row doesn't carry it.
 *
 * Each row's `data-raw-time` is an offset from `baseTime`, which defaults to the first event's timestamp. A windowed
 * caller renders only a tail slice of a longer log, and it must pass the log's stable start time. The document's time
 * cursor adds `data-raw-time` to that start time, so a per-slice base moves the cursor for a clicked row to an earlier,
 * wrong time.
 */
export function generateDocumentMarkdown(events: THaibunEvent[], minLogLevel: THaibunLogLevel, baseTime: number): { md: string; visibleIds: Set<string> } {
	let md = "";
	let lastType: "none" | "prose" | "technical" = "none";
	let previousRenderedDepth = 0;
	let previousRenderedId = "";
	const visibleIds = new Set<string>();
	const minLevelIndex = HAIBUN_LOG_LEVELS.indexOf(minLogLevel);
	const belowLevel = (e: THaibunEvent) => {
		const levelIndex = HAIBUN_LOG_LEVELS.indexOf(e.level);
		return levelIndex !== -1 && minLevelIndex !== -1 && levelIndex < minLevelIndex;
	};

	// Returns the holder of the artifacts a row's step record carries, other than video, and their ids. The renderer fills
	// each holder with its artifacts. A branch can also stamp the ids on its own row, as the technical log row does.
	const claimWithHolder = (e: THaibunEvent, nid: string) => {
		const ids = carriedOf(e)
			.filter((a) => a.artifactType !== "video")
			.map((a) => a.id)
			.join(",");
		return { ids, holder: ids ? `<div class="feature-artifacts" data-ids="${ids}" data-id="${nid}"></div>\n` : "" };
	};

	const renderedHeaders = new Set<string>();

	for (const [i, e] of events.entries()) {
		if (belowLevel(e)) continue;

		// An artifact a step's row carries renders in that row's holder. Any other renders where its record is.
		if (e.kind === "artifact") {
			if (!isCarried(e)) {
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
				const header = claimWithHolder(le, nid);
				if (header.holder) md += `\n${header.holder}`;
				lastType = "prose";
				continue;
			}

			if (le.type === "step") {
				const step = le as TStepEvent;
				const isTechnical = isTechnicalStep(step);

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

					// A step's depth is the length of its path within its actuality feature. The actuality feature that leads the
					// record name identifies the feature, so it doesn't count toward the depth.
					const depth = parseRecordName(step.id)?.path.length ?? 0;
					const isNested = depth > 3;
					const time = ((step.timestamp - baseTime) / 1000).toFixed(3);
					const rawTime = step.timestamp - baseTime;
					const actionName = step.actionName || "step";
					const showSymbol = previousRenderedId && previousRenderedDepth < depth;
					const nid = normalizeId(le.id);
					visibleIds.add(nid);
					const claimed = claimWithHolder(le, nid);

					md += `<div class="${LOG_ROW_CLASS}" data-depth="${depth}" data-nested="${isNested}" data-instigator="${isInstigator}" data-show-symbol="${showSymbol}" data-id="${nid}" data-ids="${claimed.ids}" data-time="${time}" data-raw-time="${rawTime}" data-action="${esc(actionName)}" data-has-artifacts="${!!claimed.ids}">${esc(step.in)}</div>\n`;
					md += claimed.holder;
					lastType = "technical";
					previousRenderedDepth = depth;
					previousRenderedId = le.id;
				} else {
					if (lastType === "technical") md += '\n<div class="h-1"></div>\n';
					const rawTime = step.timestamp - baseTime;
					const nid = normalizeId(step.id);
					visibleIds.add(nid);
					md += `\n<div class="prose-block" data-raw-time="${rawTime}" data-id="${nid}">\n\n${step.in}\n\n</div>\n`;
					const prose = claimWithHolder(le, nid);
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
			md += `<div class="${LOG_ROW_CLASS}" data-id="${nid}" data-raw-time="${rawTime}" data-time="${time}">${esc(logEv.message)}</div>\n`;
			lastType = "technical";
			continue;
		}
	}

	return { md, visibleIds };
}
