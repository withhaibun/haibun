import { TArtifactHTML } from "@haibun/core/build/lib/interfaces/logger.js";
import { ArtifactDisplay } from "./artifactDisplayBase.js";

export class HtmlArtifactDisplay extends ArtifactDisplay {
	readonly placementTarget = 'details';
	constructor(protected artifact: TArtifactHTML) {
		super(artifact);
	}
	public render(container: HTMLElement): void {
		container.innerHTML = ''; // Clear placeholder
		const iframe = document.createElement('iframe');
		iframe.style.border = 'none';
		iframe.style.width = '100%';
		iframe.style.height = '80vh';

		if ('html' in this.artifact && typeof this.artifact.html === 'string') {
			iframe.srcdoc = this.artifact.html;
		} else if ('path' in this.artifact && typeof this.artifact.path === 'string') {
			iframe.src = this.artifact.path;
		} else {
			iframe.srcdoc = '<p class="haibun-artifact-error">Error: HTML content not available or in an unexpected format.</p>';
		}
		container.appendChild(iframe);
	}
}
