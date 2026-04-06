import React, { useMemo, useRef, useLayoutEffect } from "react";
import { ArtifactFrame } from "../components/ArtifactFrame";

// ... (other imports)

// ...

import { THttpTraceArtifact } from "@haibun/core/schema/protocol.js";
import { MermaidArtifact } from "./MermaidArtifact";
import { escapeLabel } from "./mermaid-utils";
import { DIMMED_OPACITY, DIMMED_COLOUR } from "../lib/timeline";
import { scrollIntoViewIfNeeded } from "../lib/dom-utils";

interface HttpTraceSequenceDiagramProps {
	traces: THttpTraceArtifact[];
	currentTime?: number;
	startTime?: number;
}

/**
 * Generates a mermaid sequence diagram from http-trace artifacts.
 * Shows request/response flow between browser and servers.
 * Highlights the current request based on timeline position via DOM manipulation.
 */
export function HttpTraceSequenceDiagram({ traces, currentTime, startTime = 0 }: HttpTraceSequenceDiagramProps) {
	// Generate stable Mermaid source (independent of time)
	const mermaidSource = useMemo(() => {
		if (traces.length === 0) {
			return "";
		}

		// Group traces by request/response pairs
		const participants = new Set<string>();
		participants.add("Browser");

		// Extract unique server hosts
		traces.forEach((trace) => {
			if (trace.trace.requestingURL) {
				try {
					const url = new URL(trace.trace.requestingURL);
					participants.add(url.hostname || "Server");
				} catch {
					participants.add("Server");
				}
			}
		});

		// Build sequence diagram
		let source = "sequenceDiagram\n";

		// Add participants
		source += "  participant Browser\n";
		participants.forEach((p) => {
			if (p !== "Browser") {
				source += `  participant ${sanitizeParticipant(p)}\n`;
			}
		});

		// Add messages for each trace (Render ALL as active/solid arrows)
		traces.forEach((trace) => {
			const host = getHost(trace.trace.requestingURL || trace.trace.requestingPage);
			const sanitizedHost = sanitizeParticipant(host);

			if (trace.httpEvent === "request" || trace.httpEvent === "route") {
				const method = trace.trace.method || "GET";
				const path = getPath(trace.trace.requestingURL);
				const label = `${method} ${path}`;
				const escapedLabel = escapeLabel(label);

				// Always use solid arrows (->>) for requests
				source += `  Browser->>${sanitizedHost}: ${escapedLabel}\n`;
			} else if (trace.httpEvent === "response") {
				const status = trace.trace.status || 200;
				const label = `${status} ${trace.trace.statusText || ""}`;
				const escapedLabel = escapeLabel(label);

				// Always use dotted arrows (-->>) for responses
				source += `  ${sanitizedHost}-->>Browser: ${escapedLabel}\n`;
			}
		});

		return source;
	}, [traces]);

	// key memoization for artifact to minimize re-renders
	const artifactObject = useMemo(
		() =>
			({
				artifactType: "mermaid",
				source: mermaidSource,
				id: "http-trace-sequence",
				kind: "artifact",
				mimetype: "text/x-mermaid",
				// biome-ignore lint/suspicious/noExplicitAny: complex union type
			}) as any,
		[mermaidSource],
	);

	// Calculate current index - which trace is "current" based on timeline position
	const currentTraceIndex = useMemo(() => {
		if (currentTime === undefined || traces.length === 0) return -1;
		const currentAbsoluteTime = startTime + currentTime;
		let idx = -1;
		for (let i = traces.length - 1; i >= 0; i--) {
			if (traces[i].timestamp <= currentAbsoluteTime) {
				idx = i;
				break;
			}
		}
		// If no trace has occurred yet (timeline at very start), show none as current
		// but don't dim everything - the first trace should be next
		return idx;
	}, [traces, currentTime, startTime]);

	// Track if we've done initial render to avoid scrolling on first paint
	const hasRenderedRef = useRef(false);

	if (!mermaidSource || traces.length === 0) {
		return <div className="text-slate-500 text-sm">No HTTP traces available</div>;
	}

	const scrollRef = useRef<HTMLDivElement>(null);
	const [zoom, setZoom] = React.useState(100);

	// DOM Effect: Highlight current trace and fade future ones
	useLayoutEffect(() => {
		if (!scrollRef.current) return;
		const container = scrollRef.current;

		// Mermaid sequence diagram v10 usually puts text in <text class="messageText">
		// or sometimes just <text> inside <g class="messageText">
		// We try querying .messageText (class on text element)
		const messageTexts = container.querySelectorAll(".messageText");

		if (messageTexts.length === 0) {
			// Fallback or debug?
			// Maybe mermaid hasn't rendered yet?
			// onRender callback handles scroll initial, but updates happen here.
			return;
		}

		// Iterate all traces to set state
		traces.forEach((_, idx) => {
			if (idx >= messageTexts.length) return; // Mismatch safety

			const el = messageTexts[idx] as SVGElement;

			if (currentTraceIndex === -1) {
				// Timeline before any traces - show all as "future" (dimmed)
				el.style.fontWeight = "normal";
				el.style.fill = DIMMED_COLOUR;
				el.style.opacity = String(DIMMED_OPACITY);
				el.style.fontSize = "";
			} else if (idx === currentTraceIndex) {
				// Highlight current trace
				el.style.fontWeight = "bold";
				el.style.fill = "#e87a5d"; // Highlight color
				el.style.opacity = "1";
				el.style.fontSize = "14px"; // Pop

				// Only scroll after initial render and only if not already visible
				if (hasRenderedRef.current) {
					scrollIntoViewIfNeeded(el, scrollRef.current, { behavior: "auto", block: "center", inline: "center" });
				}
			} else if (idx > currentTraceIndex) {
				// Future - dimmed using shared constants
				el.style.fontWeight = "normal";
				el.style.fill = DIMMED_COLOUR;
				el.style.opacity = String(DIMMED_OPACITY);
				el.style.fontSize = "";
			} else {
				// Past
				el.style.fontWeight = "normal";
				el.style.fill = "black";
				el.style.opacity = "1";
				el.style.fontSize = "";
			}
		});

		// Mark that we've rendered once
		hasRenderedRef.current = true;
	}, [currentTraceIndex, traces.length]);

	const handleCopy = async () => {
		if (!mermaidSource) return;
		try {
			if (navigator.clipboard) {
				await navigator.clipboard.writeText(mermaidSource);
			} else {
				const textArea = document.createElement("textarea");
				textArea.value = mermaidSource;
				textArea.style.position = "fixed";
				textArea.style.left = "-9999px"; // Hide the textarea
				document.body.appendChild(textArea);
				textArea.focus();
				textArea.select();
				document.execCommand("copy");
				document.body.removeChild(textArea);
			}
		} catch (err) {
			console.error("Failed to copy", err);
		}
	};

	/* Controls */
	const toolbar = (
		<div className="flex items-center gap-4 h-full">
			{/* Controls: Zoom */}
			<div className="flex items-center gap-1 border-r border-slate-200 pr-4 h-full">
				<button
					onClick={() => setZoom((z) => Math.max(10, z - 10))}
					className="p-1 hover:bg-slate-100 rounded text-slate-600 font-bold w-6 h-6 flex items-center justify-center transform scale-y-110"
					title="Zoom Out"
				>
					-
				</button>
				<span className="text-xs text-slate-500 w-8 text-center select-none">{zoom}%</span>
				<button
					onClick={() => setZoom((z) => Math.min(200, z + 10))}
					className="p-1 hover:bg-slate-100 rounded text-slate-600 font-bold w-6 h-6 flex items-center justify-center"
					title="Zoom In"
				>
					+
				</button>
			</div>

			{/* [Info] */}
			<div className="text-xs text-slate-500 font-mono px-2 whitespace-nowrap">{currentTraceIndex >= 0 ? `${currentTraceIndex + 1}/${traces.length}` : traces.length} events</div>
		</div>
	);

	return (
		<ArtifactFrame title="Sequence Diagram" toolbar={toolbar} onCopy={handleCopy} className="http-trace-sequence">
			<div ref={scrollRef} className="overflow-auto flex-1 bg-white relative max-h-full">
				<div style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top left", minWidth: "100%", minHeight: "100%" }}>
					<MermaidArtifact artifact={artifactObject} containerClassName="min-h-full" unstyled={true} />
				</div>
			</div>
		</ArtifactFrame>
	);
}

// Helper functions (kept)
function sanitizeParticipant(name: string): string {
	return name.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 20);
}

function getHost(url: string | undefined): string {
	if (!url) return "Server";
	try {
		const parsed = new URL(url);
		return parsed.hostname || "Server";
	} catch {
		return "Server";
	}
}

function getPath(url: string | undefined): string {
	if (!url) return "/";
	try {
		const parsed = new URL(url);
		const path = parsed.pathname || "/";
		return path.length > 30 ? path.substring(0, 27) + "..." : path;
	} catch {
		return "/";
	}
}

export function generateSequenceDiagramFromTraces(traces: THttpTraceArtifact[]): string {
	if (traces.length === 0) return "";
	const participants = new Set<string>();
	participants.add("Browser");
	traces.forEach((trace) => participants.add(getHost(trace.trace.requestingURL || trace.trace.requestingPage)));

	let source = "sequenceDiagram\n";
	source += "  participant Browser\n";
	participants.forEach((p) => {
		if (p !== "Browser") source += `  participant ${sanitizeParticipant(p)}\n`;
	});

	traces.forEach((trace) => {
		const host = getHost(trace.trace.requestingURL || trace.trace.requestingPage);
		const sanitizedHost = sanitizeParticipant(host);
		if (trace.httpEvent === "request" || trace.httpEvent === "route") {
			const method = trace.trace.method || "GET";
			const path = getPath(trace.trace.requestingURL);
			source += `  Browser->>${sanitizedHost}: ${method} ${path}\n`;
		} else if (trace.httpEvent === "response") {
			const status = trace.trace.status || 200;
			const statusText = trace.trace.statusText || "";
			source += `  ${sanitizedHost}-->>Browser: ${status}${statusText ? " " + statusText : ""}\n`;
		}
	});

	return source;
}
