import { TArtifactJSON } from "@haibun/core/build/lib/interfaces/logger.js";
import { ArtifactDisplay } from "./artifactDisplayBase.js";
import { disclosureJson } from "../disclosureJson.js";

export class JsonArtifactDisplay extends ArtifactDisplay {
	readonly placementTarget = 'details';
	constructor(artifact: TArtifactJSON) {
		super(artifact);
	}
	render(container: HTMLElement): void {
		const artifact = this.artifact as TArtifactJSON;
		try {
			const jsonElement = disclosureJson(artifact.json as Record<string, unknown>);
			container.innerHTML = '';
			if (jsonElement) {
				const preElement = document.createElement('pre');
				preElement.classList.add('haibun-message-details-json');
				preElement.appendChild(jsonElement);
				container.appendChild(preElement);
			}
		} catch (error) {
			console.error(`Error rendering JSON artifact:`, error);
			container.innerHTML = `<p class="haibun-artifact-error">Error rendering JSON: ${(error as Error).message}</p>`;
		}
	}
}
