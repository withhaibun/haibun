import React from "react";
import { THaibunEvent, TArtifactEvent } from "@haibun/core/schema/protocol.js";

type InlineArtifactsProps = {
	e: THaibunEvent;
	onSelectArtifact: (artifact: TArtifactEvent) => void;
	selectedArtifactId?: string;
};

export const InlineArtifacts = ({ e, onSelectArtifact, selectedArtifactId }: InlineArtifactsProps) => {
	// biome-ignore lint/suspicious/noExplicitAny: loose artifact type
	let embeddedArtifacts: any[] | undefined = undefined;

	if (e.kind === "log") {
		// biome-ignore lint/suspicious/noExplicitAny: loose artifact type
		embeddedArtifacts = e.attributes?.artifacts as any[];
	} else if (e.kind === "lifecycle") {
		embeddedArtifacts =
			"products" in e && e.products ? ((e.products as Record<string, unknown>).artifacts as TArtifactEvent[]) : undefined;
	}

	if (!embeddedArtifacts || !Array.isArray(embeddedArtifacts) || embeddedArtifacts.length === 0) {
		return null;
	}

	return (
		<div className="ml-20 my-1 space-y-1">
			{
				// biome-ignore lint/suspicious/noExplicitAny: loose artifact type
				embeddedArtifacts.map((artifact: any, idx: number) => {
					const artifactId = `${e.id}.artifact.${idx}`;
					const isSelected = selectedArtifactId === artifactId;
					const artifactEvent: TArtifactEvent = {
						id: artifactId,
						timestamp: e.timestamp,
						source: "haibun",
						kind: "artifact",
						artifactType: artifact.artifactType,
						mimetype: artifact.mimetype || "application/octet-stream",
						...("path" in artifact && { path: artifact.path }),
						...("json" in artifact && { json: artifact.json }),
						...("transcript" in artifact && { transcript: artifact.transcript }),
						...("resolvedFeatures" in artifact && { resolvedFeatures: artifact.resolvedFeatures }),
					} as TArtifactEvent;
					return (
						<div key={artifactId} className="border border-slate-700 rounded bg-slate-900/50">
							<button
								onClick={() => onSelectArtifact(artifactEvent)}
								className={`w-full text-left px-2 py-1 text-xs text-slate-400 hover:bg-slate-800/50 flex items-center gap-1 ${isSelected ? "text-cyan-400 bg-slate-800/50" : ""}`}
							>
								<span>📎 {artifact.artifactType}</span>
								{"path" in artifact && <span className="text-slate-500 truncate">- {artifact.path}</span>}
							</button>
						</div>
					);
				})
			}
		</div>
	);
};
