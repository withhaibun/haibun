import { TArtifactImage } from '@haibun/core/lib/interfaces/logger.js';
import { ArtifactDisplay } from './artifactDisplayBase.js';

export class ImageArtifactDisplay extends ArtifactDisplay {
    readonly placementTarget = 'details'; // This artifact is always placed in details
    constructor(protected artifact: TArtifactImage) {
        super(artifact); // type is 'image' by default from TArtifactImage
        // Element creation is deferred to render method
    }
    public render(container: HTMLElement): void {
        const imgElement = document.createElement('img');
        imgElement.alt = 'Screen capture artifact'; // Default alt text
        imgElement.src = this.artifact.path;
        container.replaceChildren(imgElement); // Clear placeholder and add image
    }
}
