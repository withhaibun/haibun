import { TArtifactResolvedFeatures } from "@haibun/core/lib/interfaces/logger.js";
import { generateMermaidGraphAsMarkdown } from "../graph/generateMermaidGraph.js";
import { ArtifactDisplay } from "./artifactDisplayBase.js";

import mermaid from 'mermaid';

mermaid.initialize({
	maxTextSize: 1000000,
	maxEdges: 10000,
});

let instanceCounter = 0;

export class ResolvedFeaturesArtifactDisplay extends ArtifactDisplay {
	readonly placementTarget = 'details';

	constructor(protected artifact: TArtifactResolvedFeatures) {
		super(artifact);
	}

	public async render(container: HTMLElement): Promise<void> {
		// The artifact is already typed as TArtifactResolvedFeatures due to the constructor
		if (!this.artifact.resolvedFeatures || this.artifact.resolvedFeatures.length === 0) {
			container.innerHTML = '<p>No resolved features to display.</p>';
			return;
		}

		const mermaidGraph = await generateMermaidGraphAsMarkdown(this.artifact.resolvedFeatures, false);

		const graphSvgId = `mermaid-graph-svg-${instanceCounter++}-${Date.now()}`;

		container.innerHTML = ''; // Clear placeholder

		try {
			const { svg, bindFunctions } = await mermaid.render(graphSvgId, mermaidGraph);
			container.innerHTML = svg;

			if (bindFunctions) {
				bindFunctions(container);
			}
		} catch (error) {
			console.error('Error rendering Mermaid graph:', error);
			container.innerHTML = `<p class="haibun-artifact-error">Error rendering graph: ${(error as Error).message}</p>`;
		}
	}
}
