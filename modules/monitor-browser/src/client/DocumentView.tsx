import React, { useMemo, useState } from "react";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import parse, { DOMNode, Element as ReactParserElement, domToReact } from "html-react-parser";
import { type THaibunEvent, type TArtifactEvent, type THaibunLogLevel, type TLifecycleEvent } from "@haibun/core/schema/protocol.js";
import { buildArtifactIndex, generateDocumentMarkdown } from "@haibun/core/lib/document-content.js";
import { ArtifactRenderer } from "./artifacts";
import { TEST_IDS } from "../test-ids";
import { scrollIntoViewIfNeeded } from "./lib/dom-utils";
import { FUTURE_EVENT_CLASS } from "./lib/timeline";

const md = new MarkdownIt({
	html: true,
	linkify: true,
	typographer: true,
});

interface DocumentViewProps {
	events: THaibunEvent[];
	currentTime: number;
	startTime: number | null;
	onTimeChange: (time: number) => void;
	minLogLevel?: THaibunLogLevel;
	onSelectEvent?: (event: THaibunEvent) => void;
}

export function DocumentView({
	events,
	currentTime,
	startTime,
	onTimeChange,
	minLogLevel = "info",
	onSelectEvent,
}: DocumentViewProps) {
	const { artifactsByStep, allArtifactIds } = useMemo(() => buildArtifactIndex(events), [events]);
	const content = useMemo(() => generateDocumentMarkdown(events, artifactsByStep, minLogLevel), [events, artifactsByStep, allArtifactIds, minLogLevel]);

	// Helper to find original event by ID
	const findEvent = (id: string | undefined): THaibunEvent | undefined => {
		if (!id) return undefined;
		const normalizedTarget = id.replace(/^\[|\]$/g, "");
		return events.find((e) => (e.id || "").replace(/^\[|\]$/g, "") === normalizedTarget);
	};

	const activeEventId = useMemo(() => {
		const { visibleIds } = content;
		const effectiveCurrentTime = (startTime || 0) + currentTime + 0.0001;
		for (let i = events.length - 1; i >= 0; i--) {
			const e = events[i];
			if (e.timestamp !== undefined && e.timestamp <= effectiveCurrentTime) {
				// Only selecting steps and logs for "dot" tracking. Ignoring structural headers.
				if (e.kind === "lifecycle" && e.stage === "start") {
					const le = e as TLifecycleEvent;
					if (le.type === "feature" || le.type === "scenario" || (le.type as string) === "background") {
						continue;
					}
				}

				if (e.id && (e.kind === "log" || (e.kind === "lifecycle" && e.stage === "start"))) {
					const normalized = e.id.replace(/^\[|\]$/g, "");
					if (visibleIds.has(normalized)) return normalized;
				}
			}
		}
		return null;
	}, [events, currentTime, startTime, content]);

	const reactContent = useMemo(() => {
		const rawHtml = md.render(content.md);

		const sanitizedHtml = DOMPurify.sanitize(rawHtml, {
			ADD_ATTR: [
				"style",
				"data-depth",
				"data-nested",
				"data-instigator",
				"data-show-symbol",
				"data-id",
				"data-time",
				"data-raw-time",
				"data-action",
				"data-has-artifacts",
			],
			ADD_TAGS: ["div"],
		});

		const RowWithGutter = ({
			children,
			dataId,
			rawTime,
			onClick,
			className = "",
			noPadding = false,
		}: {
			children: React.ReactNode;
			dataId: string | undefined;
			rawTime?: number;
			onClick?: (e: React.MouseEvent) => void;
			className?: string;
			noPadding?: boolean;
		}) => {
			// Check if this row is in the future relative to current time
			const isFuture = rawTime !== undefined && rawTime > currentTime;
			const futureClass = isFuture ? FUTURE_EVENT_CLASS : "";

			return (
				<div
					className={`group flex items-start -mx-4 px-4 ${noPadding ? "" : "py-1"} transition-colors cursor-pointer hover:bg-slate-50 relative document-row ${className} ${futureClass}`}
					onClick={(e) => {
						// When clicking a row, also update the timeline position
						if (rawTime !== undefined) {
							onTimeChange(rawTime);
						}
						onClick?.(e);
					}}
					data-id={dataId}
					data-testid={dataId ? `${TEST_IDS.TIMELINE_SELECTION.DOCUMENT_ROW_PREFIX}${dataId}` : undefined}
				>
					{/* Fixed Gutter for Marker */}
					<div className="w-8 shrink-0 flex items-start justify-center pt-[15px] select-none absolute left-0 top-0 bottom-0 pointer-events-none">
						<div className="active-dot w-2.5 h-2.5 bg-cyan-500 rounded-full shadow-sm ring-2 ring-cyan-100 opacity-0 transition-opacity duration-200" />
					</div>

					{/* Content Container with offset for gutter */}
					<div className="flex-1 min-w-0 pl-6">{children}</div>
				</div>
			);
		};

		// biome-ignore lint/suspicious/noExplicitAny: html-react-parser replace function signature requires this
		const handleNode = (domNode: DOMNode): any => {
			if (domNode instanceof ReactParserElement && domNode.attribs) {
				if (domNode.name === "div" && domNode.attribs.class === "feature-artifacts") {
					const stepId = domNode.attribs["data-id"];
					const idString = domNode.attribs["data-ids"];
					if (!idString) return null;

					const artifactIds = idString.split(",");
					const stepArtifacts = artifactIds.map((id) => events.find((e) => e.id === id)).filter(Boolean) as TArtifactEvent[];

					if (stepArtifacts.length === 0) return null;

					return (
						<div className="space-y-1 pl-6">
							{stepArtifacts.map((artifact, idx) => (
								<ArtifactCaption key={`${stepId}-artifact-${idx}`} artifact={artifact} />
							))}
						</div>
					);
				}

				if (domNode.name === "div" && domNode.attribs.class === "standalone-artifact") {
					const id = domNode.attribs["data-id"];
					const artifact = events.find((ev) => ev.id === id) as TArtifactEvent;
					if (!artifact) return null;

					return (
						<RowWithGutter
							dataId={id}
							noPadding={true}
							onClick={(e) => {
								e.stopPropagation();
								const event = findEvent(id);
								if (event && onSelectEvent) onSelectEvent(event);
							}}
						>
							<ArtifactCaption key={`standalone-${id}`} artifact={artifact} />
						</RowWithGutter>
					);
				}

				if (domNode.name === "div" && domNode.attribs.class?.includes("log-row")) {
					const depth = parseInt(domNode.attribs["data-depth"] || "0");
					const isNested = domNode.attribs["data-nested"] === "true";
					const isInstigator = domNode.attribs["data-instigator"] === "true";
					const showSymbol = domNode.attribs["data-show-symbol"] === "true";
					const stepId = domNode.attribs["data-id"];
					const idString = domNode.attribs["data-ids"];
					const rawTime = parseFloat(domNode.attribs["data-raw-time"] || "0");

					const stepArtifacts = idString
						? (idString
								.split(",")
								.map((id) => events.find((e) => e.id === id))
								.filter(Boolean) as TArtifactEvent[])
						: [];

					return (
						<RowWithGutter
							dataId={stepId}
							rawTime={rawTime}
							onClick={(e) => {
								e.stopPropagation();
								const event = findEvent(stepId);
								if (event && onSelectEvent) onSelectEvent(event);
							}}
						>
							<div className="flex items-stretch break-all">
								<span className="mx-1 text-slate-400 self-start mt-1">｜</span>

								<div className="flex-1 flex items-stretch">
									<div style={{ width: `${Math.max(0, depth - 4) * 0.75}rem` }} className="shrink-0" />

									{(isNested || isInstigator) && (
										<div className="relative w-4 shrink-0 mr-1">
											{isNested && <div className="absolute top-0 -bottom-[1px] right-[3px] w-px bg-slate-200" />}
											{isInstigator && !isNested && (
												<div className="absolute top-[6px] -bottom-[1px] right-[3px] w-px bg-slate-200" />
											)}
											{isNested && showSymbol && <div className="absolute top-0 right-[3px] w-2.5 h-px bg-slate-200" />}
										</div>
									)}

									<div className="flex-1 py-0.5 text-slate-600">
										{domToReact(domNode.children as DOMNode[], { replace: handleNode })}
									</div>
								</div>
							</div>

							{stepArtifacts.length > 0 && (
								<div className="ml-8 space-y-1">
									{stepArtifacts.map((artifact, idx) => (
										<ArtifactCaption key={`${stepId}-artifact-${idx}`} artifact={artifact} />
									))}
								</div>
							)}
						</RowWithGutter>
					);
				}

				const isProse =
					domNode instanceof ReactParserElement && domNode.name === "div" && domNode.attribs.class?.includes("prose-block");
				const isHeader =
					domNode instanceof ReactParserElement && domNode.name === "div" && domNode.attribs.class?.includes("header-block");

				if (isProse || isHeader) {
					const stepId = (domNode as ReactParserElement).attribs["data-id"];
					const rawTime = parseFloat((domNode as ReactParserElement).attribs["data-raw-time"] || "0");

					return (
						<RowWithGutter
							dataId={stepId}
							rawTime={rawTime}
							onClick={(e) => {
								e.stopPropagation();
								const event = findEvent(stepId);
								if (event && onSelectEvent) onSelectEvent(event);
							}}
						>
							{domToReact((domNode as ReactParserElement).children as DOMNode[], { replace: handleNode })}
						</RowWithGutter>
					);
				}

				if (domNode.name === "div" && domNode.attribs.class?.includes("font-mono") && !domNode.attribs.class?.includes("log-row")) {
					return (
						<div
							className={domNode.attribs.class}
							style={domNode.attribs.style ? { paddingLeft: domNode.attribs.style.split(":")[1] } : undefined}
						>
							{domToReact(domNode.children as DOMNode[], { replace: handleNode })}
						</div>
					);
				}

				// Simple passthrough for standard elements
				if (domNode.name === "a") {
					return (
						<a {...domNode.attribs} className="text-blue-600 hover:underline">
							{domToReact(domNode.children as DOMNode[], { replace: handleNode })}
						</a>
					);
				}
				if (domNode.name === "h1") {
					return (
						<h1 className="text-3xl font-bold mt-6 mb-4 pb-2 border-b border-border">
							{domToReact(domNode.children as DOMNode[], { replace: handleNode })}
						</h1>
					);
				}
				if (domNode.name === "h2") {
					return (
						<h2 className="text-2xl font-semibold mt-6 mb-3 text-slate-900">
							{domToReact(domNode.children as DOMNode[], { replace: handleNode })}
						</h2>
					);
				}
				if (domNode.name === "h3") {
					return (
						<h3 className="text-xl font-semibold mt-4 mb-2">
							{domToReact(domNode.children as DOMNode[], { replace: handleNode })}
						</h3>
					);
				}
				if (domNode.name === "h4") {
					return (
						<h4 className="text-lg font-bold mt-4 mb-1">{domToReact(domNode.children as DOMNode[], { replace: handleNode })}</h4>
					);
				}
				if (domNode.name === "ul") {
					return (
						<ul className="list-disc pl-6 mb-1 space-y-0.5">
							{domToReact(domNode.children as DOMNode[], { replace: handleNode })}
						</ul>
					);
				}
				if (domNode.name === "ol") {
					return (
						<ol className="list-decimal pl-6 mb-1 space-y-0.5">
							{domToReact(domNode.children as DOMNode[], { replace: handleNode })}
						</ol>
					);
				}
				if (domNode.name === "li") {
					return <li className="leading-relaxed">{domToReact(domNode.children as DOMNode[], { replace: handleNode })}</li>;
				}
				if (domNode.name === "blockquote") {
					return (
						<blockquote className="border-l-4 border-muted-foreground/30 pl-4 italic text-muted-foreground my-4">
							{domToReact(domNode.children as DOMNode[], { replace: handleNode })}
						</blockquote>
					);
				}
				if (domNode.name === "code") {
					const isBlock = domNode.parent && (domNode.parent as ReactParserElement).name === "pre";
					if (!isBlock) {
						return (
							<code className="bg-slate-100 px-1 py-0.5 rounded-sm text-xs font-mono text-slate-800 border border-slate-200">
								{domToReact(domNode.children as DOMNode[], { replace: handleNode })}
							</code>
						);
					}
				}
				if (domNode.name === "pre") {
					return (
						<pre className="bg-muted/50 p-4 rounded-lg overflow-x-auto my-4 text-sm font-mono">
							{domToReact(domNode.children as DOMNode[], { replace: handleNode })}
						</pre>
					);
				}
				if (domNode.name === "table") {
					return (
						<div className="overflow-x-auto my-4 border rounded-lg">
							<table className="w-full text-sm text-left">
								{domToReact(domNode.children as DOMNode[], { replace: handleNode })}
							</table>
						</div>
					);
				}
			}
		};

		return parse(sanitizedHtml, { replace: handleNode });
	}, [content.md, artifactsByStep, events, onSelectEvent]);

	// Manage Active State (Highlight + Scroll)
	const containerRef = React.useRef<HTMLDivElement>(null);
	React.useLayoutEffect(() => {
		if (!containerRef.current || !activeEventId) return;

		// 1. Identify Target Elements (Leaf + Parents)
		const targets: HTMLElement[] = [];
		let id = activeEventId;
		while (id) {
			const el = containerRef.current.querySelector(`.document-row[data-id="${id}"]`) as HTMLElement | null;
			if (el) targets.push(el);
			if (id.includes(".")) {
				id = id.substring(0, id.lastIndexOf("."));
			} else {
				break;
			}
		}

		// Safeguard: If active ID exists but no DOM elements found,
		// abort update to preserve previous highlight (prevents flickering/missing dot)
		if (targets.length === 0) return;

		// 2. Add class to ALL targets FIRST (preserves transition if already active)
		targets.forEach((el) => el.classList.add("active-row"));

		// 3. Remove class from any element that is NOT a target
		const currentActiveInfo = containerRef.current.querySelectorAll(".active-row");
		currentActiveInfo.forEach((el) => {
			// Check if this element is in our target list
			// (Comparing DOM node references works)
			let isTarget = false;
			for (const t of targets) {
				if (t === el) {
					isTarget = true;
					break;
				}
			}
			if (!isTarget) el.classList.remove("active-row");
		});

		// 4. Scroll to leaf
		const leaf = targets[0];
		if (leaf) {
			scrollIntoViewIfNeeded(leaf, null, { behavior: "smooth", block: "nearest" });
		}
	}, [activeEventId, events]);

	return (
		<div
			ref={containerRef}
			className="w-full bg-white text-slate-900 min-h-screen p-4 md:p-8"
			data-active-id={activeEventId}
			data-testid={TEST_IDS.VIEWS.DOCUMENT}
		>
			<div className="w-full max-w-5xl mx-auto">
				<div
					className="prose prose-slate max-w-none font-serif leading-relaxed text-slate-900 
                    prose-headings:font-bold prose-headings:text-slate-900 prose-headings:my-2 prose-headings:mt-0
                    prose-h1:text-3xl prose-h1:border-b prose-h1:border-slate-200 prose-h1:pb-2
                    prose-h2:text-2xl 
                    prose-p:my-1 prose-p:mt-0 prose-p:text-base md:prose-p:text-lg
                    prose-ul:mt-0 prose-ol:mt-0
                    prose-code:text-slate-800 prose-code:bg-slate-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded-sm prose-code:font-mono prose-code:text-sm
                "
				>
					{reactContent}
				</div>
				<style>{`
                    .prose blockquote p:first-of-type::before {
                        content: none;
                    }
                    .prose blockquote p:last-of-type::after {
                        content: none;
                    }
                    /* Highlighting logic based on class */
                    .document-row {
                        transition: background-color 0.3s ease;
                    }
                    .document-row .active-dot {
                        opacity: 0;
                        transform: scale(0.8);
                        transition: opacity 0.2s ease, transform 0.2s ease;
                        display: block;
                    }
                    .document-row.active-row .active-dot {
                        opacity: 1 !important;
                        transform: scale(1) !important;
                    }
                `}</style>
			</div>
		</div>
	);
}

function ArtifactCaption({ artifact }: { artifact: TArtifactEvent }) {
	const label = artifact.artifactType || "artifact";
	const isHiddenByDefault = label === "mermaid" || label === "resolvedFeatures" || label === "video-start" || label === "video";
	const [isOpen, setIsOpen] = useState(!isHiddenByDefault);

	const path = (artifact as TArtifactEvent & { path?: string }).path || artifact.id;
	const filename = path.split("/").pop();

	return (
		<div className="mt-2 pl-2 border-l-2 border-slate-300">
			<div
				className="flex items-center gap-1 cursor-pointer select-none text-[11px] text-slate-500"
				onClick={() => setIsOpen(!isOpen)}
			>
				<span className="text-[10px] text-slate-400 w-3 text-center">{isOpen ? "▼" : "▶"}</span>
				<span className="font-mono text-slate-600 font-medium">{label}</span>
				{label === "file" && <span className="text-slate-400">:{filename}</span>}
			</div>
			{isOpen && (
				<div className="mt-1">
					<ArtifactRenderer artifact={artifact} displayMode="document" />
				</div>
			)}
		</div>
	);
}
