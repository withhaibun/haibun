import { TArtifactVideoStart } from '@haibun/core/build/lib/interfaces/logger.js';
import { ArtifactDisplay } from './artifactDisplayBase.js';

export class VideoStartArtifactDisplay extends ArtifactDisplay {
	readonly placementTarget = 'body';
	constructor(protected artifact: TArtifactVideoStart) {
		super(artifact);
	}
	public render(container: HTMLElement): void {
		const span = document.createElement('span');
		span.id = 'haibun-video-start';
		span.dataset.start = `${this.artifact.start}`;
		container.replaceChildren(span);
	}
}
