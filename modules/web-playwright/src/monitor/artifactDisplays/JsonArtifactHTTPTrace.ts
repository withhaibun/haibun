import { TArtifactHTTPTrace } from '@haibun/core/lib/interfaces/logger.js';
import { ArtifactDisplay } from './artifactDisplayBase.js';
import { TAnyFixme } from '@haibun/core/lib/fixme.js';
import { disclosureJson } from '../disclosureJson.js';
import { SequenceDiagramGenerator } from './SequenceDiagramGenerator.js';

export class JsonArtifactHTTPTrace extends ArtifactDisplay {
	readonly placementTarget: 'details' | 'haibun-focus';
	diagramGenerator: SequenceDiagramGenerator;
	id: string;

	constructor(protected artifact: TArtifactHTTPTrace) {
		super(artifact);
		this.placementTarget = document.querySelector('#sequence-diagram') ? 'haibun-focus' : 'details';
	}

	public deriveLabel(): string {
		return '⇄ Trace';
	}

	public async render(container: HTMLElement): Promise<void> {
		container.innerHTML = '';

		const preElement = document.createElement('pre');
		preElement.classList.add('haibun-message-details-json');
		const jsonDetailElement = disclosureJson(this.artifact.trace as Record<string, TAnyFixme>);
		if (jsonDetailElement) {
			preElement.appendChild(jsonDetailElement);
		}
		container.appendChild(preElement);

		if (!this.diagramGenerator) {
			this.id = Math.random().toString(36).substring(2, 15);
			this.diagramGenerator = new SequenceDiagramGenerator(this.id, container);
		}
		if (this.artifact.httpEvent !== 'route') {
			const seqDiagElement = document.getElementById('sequence-diagram');
			if (seqDiagElement && seqDiagElement.offsetParent !== null) {
				try {
					await this.diagramGenerator.update();
				} catch (error) {
					console.error("Error updating sequence diagram:", error);
					const errorP = document.createElement('p');
					errorP.className = 'haibun-artifact-error';
					errorP.textContent = `Error updating sequence diagram: ${(error as Error).message}`;
					container.appendChild(errorP);
				}
			}
		}
	}
}
