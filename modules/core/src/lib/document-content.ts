/**
 * Shared document content generation for academic-paper-style rendering.
 * Used by both @haibun/monitor-browser (React) and @haibun/shu (vanilla web components).
 * Pure functions — no React, no DOM imports.
 */
import type { THaibunEvent, TArtifactEvent, THaibunLogLevel, TStepEvent, TLifecycleEvent, TLogEvent, TJsonArtifact } from "../schema/protocol.js";
import { HAIBUN_LOG_LEVELS } from "../schema/protocol.js";

export type TArtifactIndex = { artifactsByStep: Map<string, TArtifactEvent[]>; allArtifactIds: Set<string> };

const normalizeId = (id: string) => id.replace(/^\[|\]$/g, "");

/** Group artifact events by their parent step ID, including embedded artifacts from log/lifecycle events. */
export function buildArtifactIndex(events: THaibunEvent[]): TArtifactIndex {
	const map = new Map<string, TArtifactEvent[]>();
	const allIds = new Set<string>();

	for (const e of events) {
		if (e.kind === "artifact") {
			allIds.add(e.id);
			let parentId = e.id.includes(".artifact.") ? e.id.split(".artifact.")[0] : (e.id.split(".").length > 1 ? e.id.split(".").slice(0, -1).join(".") : e.id);
			parentId = normalizeId(parentId);
			if (!map.has(parentId)) map.set(parentId, []);
			map.get(parentId)?.push(e as TArtifactEvent);
		}

		let embeddedArtifacts: Record<string, unknown>[] | undefined;
		if (e.kind === "log") embeddedArtifacts = e.attributes?.artifacts as Record<string, unknown>[];
		else if (e.kind === "lifecycle") embeddedArtifacts = (e as unknown as Record<string, Record<string, unknown>>).products?.artifacts as Record<string, unknown>[];

		if (embeddedArtifacts && Array.isArray(embeddedArtifacts)) {
			const parentId = normalizeId(e.id);
			if (!map.has(parentId)) map.set(parentId, []);
			embeddedArtifacts.forEach((artifact: Record<string, unknown>, idx: number) => {
				const id = `${parentId}.artifact.${idx}`;
				allIds.add(id);
				map.get(parentId)?.push({ id, timestamp: e.timestamp, source: "haibun", kind: "artifact", artifactType: artifact.artifactType, mimetype: artifact.mimetype || "application/octet-stream", ...artifact } as TArtifactEvent);
			});
		}
	}
	return { artifactsByStep: map, allArtifactIds: allIds };
}

/** Generate markdown + data-attribute HTML for document view. Returns raw markdown string and set of visible event IDs. */
export function generateDocumentMarkdown(events: THaibunEvent[], artifactsByStep: Map<string, TArtifactEvent[]>, minLogLevel: THaibunLogLevel = "info"): { md: string; visibleIds: Set<string> } {
	let md = "";
	let lastType: "none" | "prose" | "technical" = "none";
	let previousRenderedDepth = 0;
	let previousRenderedId = "";
	const claimedArtifactIds = new Set<string>();
	const visibleIds = new Set<string>();

	const claimArtifacts = (id: string, excludeTypes: string[] = []) => {
		const nid = normalizeId(id);
		const artifacts = artifactsByStep.get(nid) || [];
		const unclaimed = artifacts.filter((a) => !claimedArtifactIds.has(a.id) && !excludeTypes.includes(a.artifactType));
		if (unclaimed.length > 0) {
			unclaimed.forEach((a) => claimedArtifactIds.add(a.id));
			return unclaimed.map((a) => a.id).join(",");
		}
		return "";
	};

	const renderedHeaders = new Set<string>();
	const minLevelIndex = HAIBUN_LOG_LEVELS.indexOf(minLogLevel);
	const baseTime = events[0]?.timestamp || 0;

	for (let i = 0; i < events.length; i++) {
		const e = events[i];

		const level = e.level || "info";
		const levelIndex = HAIBUN_LOG_LEVELS.indexOf(level);
		if (levelIndex !== -1 && minLevelIndex !== -1 && levelIndex < minLevelIndex) continue;

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

		if (e.kind === "lifecycle" && e.stage === "start") {
			const le = e as TLifecycleEvent;
			const ev = e as Record<string, unknown>;
			if (le.type === "feature" || le.type === "scenario" || (le.type as string) === "background") {
				const headerKey = `${le.type}:${ev.featurePath ?? ev.scenarioName ?? le.id}`;
				if (renderedHeaders.has(headerKey)) continue;
				renderedHeaders.add(headerKey);

				if (lastType === "technical") md += '\n<div class="h-1"></div>\n';
				const rawTime = le.timestamp - baseTime;
				const headingLevel = le.type === "feature" ? 1 : le.type === "scenario" ? 2 : 3;
				const title = le.type === "feature" ? `Feature: ${ev.featureName ?? ev.featurePath}` : le.type === "scenario" ? `Scenario: ${ev.scenarioName}` : "Background";
				const nid = normalizeId(le.id);
				visibleIds.add(nid);
				md += `\n<div class="header-block" data-raw-time="${rawTime}" data-id="${nid}">\n\n${"#".repeat(headingLevel)} ${title}\n\n</div>\n`;
				const unclaimedIds = claimArtifacts(le.id, ["video"]);
				if (unclaimedIds) md += `\n<div class="feature-artifacts" data-ids="${unclaimedIds}" data-id="${nid}"></div>\n`;
				lastType = "prose";
				continue;
			}

			if (le.type === "step") {
				const step = le as TStepEvent;
				const isTechnical = /^[a-z]/.test(step.in || "");

				if (isTechnical) {
					if (lastType !== "technical" && md.length > 0) md += '\n<div class="h-1"></div>\n';

					let isInstigator = false;
					for (let j = i + 1; j < events.length; j++) {
						const next = events[j];
						if (next.id && le.id && next.id.startsWith(le.id + ".") && next.kind === "lifecycle" && (next as TLifecycleEvent).stage === "start") { isInstigator = true; break; }
						if (next.id === le.id) continue;
						if (next.id && le.id && !next.id.startsWith(le.id)) break;
					}

					const depth = step.id ? step.id.split(".").length : 0;
					const isNested = depth > 3;
					const time = ((step.timestamp - baseTime) / 1000).toFixed(3);
					const rawTime = step.timestamp - baseTime;
					const actionName = step.actionName || "step";
					const showSymbol = previousRenderedId && previousRenderedDepth < depth;
					const nid = normalizeId(le.id);
					visibleIds.add(nid);
					const unclaimedIds = claimArtifacts(nid, ["video"]);

					md += `<div class="log-row font-mono text-[11px] text-slate-500 my-0 leading-tight" data-depth="${depth}" data-nested="${isNested}" data-instigator="${isInstigator}" data-show-symbol="${showSymbol}" data-id="${nid}" data-ids="${unclaimedIds}" data-time="${time}" data-raw-time="${rawTime}" data-action="${actionName}" data-has-artifacts="${!!unclaimedIds}">${step.in}</div>\n`;

					lastType = "technical";
					previousRenderedDepth = depth;
					previousRenderedId = le.id || "";
				} else {
					if (lastType === "technical") md += '\n<div class="h-1"></div>\n';
					const rawTime = step.timestamp - baseTime;
					const nid = normalizeId(step.id);
					visibleIds.add(nid);
					md += `\n<div class="prose-block" data-raw-time="${rawTime}" data-id="${nid}">\n\n${step.in}\n\n</div>\n`;
					const unclaimedIds = claimArtifacts(le.id, ["video"]);
					if (unclaimedIds) md += `\n<div class="feature-artifacts" data-ids="${unclaimedIds}" data-id="${nid}"></div>\n`;
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
			md += `<div class="log-row font-mono text-[11px] text-slate-500 my-0 leading-tight" data-id="${nid}" data-raw-time="${rawTime}" data-time="${time}">${logEv.message}</div>\n`;
			lastType = "technical";
			continue;
		}
	}

	return { md, visibleIds };
}
