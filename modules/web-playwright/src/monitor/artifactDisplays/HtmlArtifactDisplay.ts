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

		// TArtifactHTML is a union, check for the 'html' property for direct content
		if ('html' in this.artifact && typeof this.artifact.html === 'string') {
			iframe.srcdoc = this.artifact.html;
		} else if ('path' in this.artifact && typeof this.artifact.path === 'string') {
			// If it has a path, this display class isn't equipped to load it.
			// Log a warning and show an error in the iframe.
			console.warn(`HtmlArtifactDisplay received artifact with path: ${this.artifact.path}. This display expects direct HTML content.`);
            iframe.srcdoc = '<p class="haibun-artifact-error">Error: Artifact is a path, but direct HTML content was expected.</p>';
		} else {
            iframe.srcdoc = '<p class="haibun-artifact-error">Error: HTML content not available or in an unexpected format.</p>';
        }
		container.appendChild(iframe);
	}
}
