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
        const codeContainerId = `mermaid-code-container-${instanceCounter++}-${Date.now()}`;
        const renderedContentId = `mermaid-rendered-content-${instanceCounter++}-${Date.now()}`;

        container.innerHTML = `
            <div class="haibun-mermaid-controls">
                <button data-tab-target="${renderedContentId}" class="haibun-tab active">Rendered</button>
                <button data-tab-target="${codeContainerId}" class="haibun-tab">Code</button>
                <button class="haibun-zoom" data-zoom-level="in">+</button>
                <button class="haibun-zoom" data-zoom-level="out">-</button>
                <button class="haibun-zoom" data-zoom-level="reset">Reset</button>
            </div>
            <div id="${renderedContentId}" class="haibun-tab-content active"></div>
            <pre id="${codeContainerId}" class="haibun-tab-content" style="display: none;"><code>${mermaidGraph}</code></pre>
        `;

        const renderedContent = container.querySelector(`#${renderedContentId}`) as HTMLElement;
        const svgContainer = document.createElement('div');
        svgContainer.id = graphSvgId;
        renderedContent.appendChild(svgContainer);

		try {
			const { svg, bindFunctions } = await mermaid.render(graphSvgId, mermaidGraph);
			svgContainer.innerHTML = svg;

			if (bindFunctions) {
				bindFunctions(svgContainer);
			}

            const zoomButtons = container.querySelectorAll<HTMLButtonElement>('.haibun-zoom');
            const svgElement = svgContainer.querySelector('svg');
            let currentScale = 1;
            zoomButtons.forEach(button => {
                button.addEventListener('click', () => {
                    const level = button.dataset.zoomLevel;
                    if (level === 'in') {
                        currentScale += 0.1;
                    } else if (level === 'out') {
                        currentScale -= 0.1;
                    } else {
                        currentScale = 1;
                    }
                    svgElement.style.transform = `scale(${currentScale})`;
                });
            });

		} catch (error) {
			console.error('Error rendering Mermaid graph:', error);
			renderedContent.innerHTML = `<p class="haibun-artifact-error">Error rendering graph: ${(error as Error).message}</p>`;
		}

        const tabs = container.querySelectorAll<HTMLButtonElement>('.haibun-tab');
        const tabContents = container.querySelectorAll<HTMLElement>('.haibun-tab-content');

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                tabContents.forEach(content => {
                    content.style.display = 'none';
                    content.classList.remove('active');
                });

                const target = container.querySelector<HTMLElement>(`#${tab.dataset.tabTarget}`);
                if (target) {
                    target.style.display = 'block';
                    target.classList.add('active');
                }
            });
        });
	}
}
