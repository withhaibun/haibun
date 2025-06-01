import { TArtifactHTTPTrace } from '@haibun/core/build/lib/interfaces/logger.js';
import { ArtifactDisplay } from './artifactDisplayBase.js';
import { disclosureJson } from '../disclosureJson.js';
import { SequenceDiagramGenerator } from './SequenceDiagramGenerator.js';

export class JsonArtifactHTTPTrace extends ArtifactDisplay {
	readonly placementTarget: 'details' | 'haibun-sequence-diagram';
	private static generatorInstance: SequenceDiagramGenerator | null = null;
	private static sequenceDiagramParentElement: HTMLElement | null = null;

	constructor(protected artifact: TArtifactHTTPTrace) {
		super(artifact);
		this.placementTarget = document.querySelector('#sequence-diagram') ? 'haibun-sequence-diagram' : 'details';

		if (!JsonArtifactHTTPTrace.sequenceDiagramParentElement) {
			JsonArtifactHTTPTrace.sequenceDiagramParentElement = document.getElementById('sequence-diagram');
		}

		if (this.placementTarget === 'haibun-sequence-diagram' && JsonArtifactHTTPTrace.sequenceDiagramParentElement && !JsonArtifactHTTPTrace.generatorInstance) {
			try {
				// Use a fixed ID for the generator, as there's one sequence diagram display area
				JsonArtifactHTTPTrace.generatorInstance = new SequenceDiagramGenerator('main-sequence', JsonArtifactHTTPTrace.sequenceDiagramParentElement);
			} catch (error) {
				console.error("Failed to initialize SequenceDiagramGenerator:", error);
			}
		}
	}

	public get diagramGenerator(): SequenceDiagramGenerator | null {
		return JsonArtifactHTTPTrace.generatorInstance;
	}

	public deriveLabel(): string {
		return '⇄ Trace';
	}

	public async render(container: HTMLElement): Promise<void> {
		container.innerHTML = '';

		// Always append the JSON details for the current event to the container
		const preElement = document.createElement('pre');
		preElement.classList.add('haibun-message-details-json');
		preElement.appendChild(disclosureJson(this.artifact.trace));
		container.appendChild(preElement);

		// Update sequence diagram if it's the target and visible
		// The sequence diagram itself is a separate element in the DOM, not inside this container.
		if (this.placementTarget === 'haibun-sequence-diagram' && this.diagramGenerator) {
			if (this.artifact.httpEvent !== 'route') {
				const seqDiagElement = document.getElementById('sequence-diagram');
				// Check if the sequence diagram element is actually visible in the layout
				if (seqDiagElement && seqDiagElement.offsetParent !== null) {
					try {
						await this.diagramGenerator.update();
					} catch (error) {
						console.error("Error updating sequence diagram:", error);
						// Optionally display an error within the trace container as well
						const errorP = document.createElement('p');
						errorP.className = 'haibun-artifact-error';
						errorP.textContent = `Error updating sequence diagram: ${(error as Error).message}`;
						container.appendChild(errorP);
					}
				}
			}
		} else if (!this.diagramGenerator) {
			console.error("SequenceDiagramGenerator instance not available for JsonArtifactHTTPTrace");
			const errorP = document.createElement('p');
			errorP.className = 'haibun-artifact-error';
			errorP.textContent = 'Sequence diagram generator not available.';
			container.appendChild(errorP);
		}
	}
}
