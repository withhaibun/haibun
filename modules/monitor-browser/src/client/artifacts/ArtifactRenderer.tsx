import React from "react";
import { TArtifactEvent } from "@haibun/core/schema/protocol.js";
import { ImageArtifact } from "./ImageArtifact";
import { VideoArtifact } from "./VideoArtifact";
import { HtmlArtifact } from "./HtmlArtifact";
import { SpeechArtifact } from "./SpeechArtifact";
import { JsonArtifact } from "./JsonArtifact";
import { MermaidArtifact } from "./MermaidArtifact";
import { QuadGraphDiagram } from "./QuadGraphDiagram";

import { getMermaidFromResolvedFeatures } from "../lib/mermaid";
import { getArtifactUrl } from "../lib/utils";

interface ArtifactRendererProps {
	artifact: TArtifactEvent;
	currentTime?: number;
	videoStartTimestamp?: number | null;
	videoMetadata?: { duration: number; width: number; height: number } | null;
	displayMode?: "log" | "document";
	onTimeSync?: (time: number) => void;
	startTime?: number;
}

export function ArtifactRenderer({
	artifact,
	currentTime,
	videoStartTimestamp,
	videoMetadata,
	displayMode = "log",
	onTimeSync,
	startTime,
	className,
}: ArtifactRendererProps & { className?: string }) {
	switch (artifact.artifactType) {
		case "image":
			return <ImageArtifact artifact={artifact} />;
		case "video":
			// In document mode, show the video inline with controls (no sync)
			if (displayMode === "document") {
				return <VideoArtifact artifact={artifact} />;
			}

			// In log/details mode, always show synced video with timeline controls
			return <VideoArtifact artifact={artifact} currentTime={currentTime} videoStartTimestamp={videoStartTimestamp} startTime={startTime} sync={true} className={className} />;
		case "html":
			return <HtmlArtifact artifact={artifact} />;
		case "speech":
			return <SpeechArtifact artifact={artifact} />;
		case "json":
			// Check if this is a quadstore artifact
			if (artifact.json && typeof artifact.json === "object" && "quadstore" in artifact.json) {
				// biome-ignore lint/suspicious/noExplicitAny: quadstore data shape
				const quads = (artifact.json as any).quadstore;
				if (Array.isArray(quads)) {
					return <QuadGraphDiagram quads={quads} currentTime={currentTime} startTime={startTime} />;
				}
			}
			return <JsonArtifact artifact={artifact} />;
		case "mermaid":
			return <MermaidArtifact artifact={artifact} />;
		case "resolvedFeatures":
			return (
				<MermaidArtifact
					artifact={
						{
							...artifact,
							artifactType: "mermaid",
							source: getMermaidFromResolvedFeatures(artifact.resolvedFeatures || [], artifact.registeredOutcomes),
						} as Record<string, unknown>
					}
				/>
			);
		case "http-trace":
			// biome-ignore lint/suspicious/noExplicitAny: abstract artifact type mismatch
			return <JsonArtifact artifact={{ ...artifact, artifactType: "json", json: artifact.trace } as any} />;
		case "file":
			return (
				<a href={getArtifactUrl(artifact.path)} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
					📎 {artifact.path}
				</a>
			);
		case "video-start":
			return <div className="text-slate-500 text-[10px] font-mono italic">Video capture start</div>;
		default:
			return <div className="text-gray-500 text-xs">Unknown artifact type</div>;
	}
}
